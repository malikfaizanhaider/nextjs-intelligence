import { resolve, relative } from "node:path";
import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import { resolveAppDirectories } from "./analyzer/app-dir-resolver";
import type {
  AnalyzerConfig,
  Diagnostic,
  IntelligenceManifest,
  PhaseTelemetry,
  PipelineTelemetry,
} from "../../intelligence-types/src/index";
import { validateManifest } from "../../intelligence-types/src/index";
import { IntelligenceRegistry } from "./registry";
import type { DiagnosticsStore } from "./session/diagnostics-store";
import { AnalysisSession } from "./session/analysis-session";
import { ComponentAnalyzer } from "./analyzer/component-analyzer";
import { detectRoutes } from "./analyzer/route-detector";
import { detectApiRoutes, detectMiddleware } from "./analyzer/api-route-detector";
import { detectParallelSlots } from "./analyzer/parallel-slot-detector";
import { ServerActionDetector } from "./analyzer/server-action-detector";
import { GraphBuilder } from "./analyzer/graph-builder";
import { RouteIntelligenceBuilder } from "./analyzer/route-intelligence-builder";
import { CompositeDetector } from "./analyzer/composite-detector";
import { Canonicalizer } from "./analyzer/canonicalizer";
import { VerificationPass } from "./analyzer/verification";
import { OutputWriter } from "./output-writer";
import { IncrementalCache } from "./cache";
import { consoleLogger, silentLogger, type Logger } from "./logger";
import { loadConfigFile, mergeConfigs } from "./config-loader";
import { deriveMetrics, deriveBundleDiagnostics, loadBundleStats } from "./derived-metrics";

const DEFAULT_CONFIG: AnalyzerConfig = {
  projectRoot: process.cwd(),
  include: ["app/**/*.{tsx,ts}", "components/**/*.{tsx,ts}", "@ui/**/*.{tsx,ts}", "ui/**/*.{tsx,ts}"],
  exclude: ["**/*.test.*", "**/*.spec.*", "**/*.stories.*", "**/__tests__/**"],
  appDir: "",
  outputDir: ".generated/intelligence",
  incremental: true,
  cacheDir: "node_modules/.cache/intelligence",
};

/**
 * Options for orchestrating a pipeline run from the outside (CLI, plugin, tests).
 * Distinct from {@link AnalyzerConfig} which describes the project being analysed.
 */
export interface PipelineRunOptions {
  /** Custom logger; defaults to console. Pass {@link silentLogger} for `--quiet`. */
  logger?: Logger;
  /** When true, suppresses all pipeline log output. Equivalent to passing {@link silentLogger}. */
  quiet?: boolean;
  /**
   * Skip loading `.intelligencerc` / `intelligence.config.*` from disk. The
   * pipeline auto-loads project-level config by default; set this to `true`
   * when callers (tests, plugins) want to drive the pipeline entirely with
   * the in-memory `userConfig`.
   */
  skipConfigFile?: boolean;
}

/**
 * Result of a fully-instrumented pipeline run.
 */
export interface PipelineRunResult {
  manifest: IntelligenceManifest;
  telemetry: PipelineTelemetry;
}

/**
 * Main orchestrator that runs the complete intelligence pipeline.
 *
 * Pipeline:
 *   Phase 1: Raw AST Discovery (component analysis + symbol resolution)
 *   Phase 2: Route Detection (Next.js App Router scanning)
 *   Phase 3: Composite Ownership Resolution (semantic-first detection)
 *   Phase 4: Canonicalization (normalize all identities)
 *   Phase 5: Route Intelligence (recursive dependency traversal)
 *   Phase 6: Graph Construction (separated graphs)
 *   Phase 7: Verification Passes (structural validation)
 *   Phase 8: Manifest Export + Write
 */
export async function runIntelligencePipeline(
  userConfig: Partial<AnalyzerConfig> = {},
  options: PipelineRunOptions = {}
): Promise<IntelligenceManifest> {
  const { manifest } = await runIntelligencePipelineDetailed(userConfig, options);
  return manifest;
}

/**
 * Detailed variant of {@link runIntelligencePipeline} that also returns telemetry.
 */
export async function runIntelligencePipelineDetailed(
  userConfig: Partial<AnalyzerConfig> = {},
  options: PipelineRunOptions = {}
): Promise<PipelineRunResult> {
  const logger = options.quiet ? silentLogger : options.logger ?? consoleLogger;

  const resolvedProjectRoot = resolve(userConfig.projectRoot ?? DEFAULT_CONFIG.projectRoot);

  // Load `.intelligencerc.*` / `intelligence.config.*` from the project root.
  // CLI/programmatic `userConfig` always wins on conflict; loaded values fill
  // in fields the caller did not specify. Set `skipConfigFile: true` to opt
  // out (used by tests that build the config entirely in memory).
  let effectiveUserConfig = userConfig;
  if (!options.skipConfigFile) {
    const loaded = await loadConfigFile(resolvedProjectRoot);
    if (loaded.filePath) {
      logger.info(`Loaded config: ${loaded.filePath}`);
      effectiveUserConfig = mergeConfigs(loaded.config, userConfig);
    }
  }

  const appResolution = await resolveAppDirectories(resolvedProjectRoot, effectiveUserConfig.appDir);

  const config: AnalyzerConfig = {
    ...DEFAULT_CONFIG,
    ...effectiveUserConfig,
    projectRoot: resolvedProjectRoot,
    outputDir: resolve(
      resolvedProjectRoot,
      effectiveUserConfig.outputDir ?? DEFAULT_CONFIG.outputDir
    ),
    cacheDir: resolve(
      resolvedProjectRoot,
      effectiveUserConfig.cacheDir ?? DEFAULT_CONFIG.cacheDir
    ),
    appDir: appResolution.primaryAppDir,
    include: effectiveUserConfig.include ?? appResolution.candidateAppDirs.flatMap((dir) => [
      `${dir}/**/*.{tsx,ts,jsx,js}`,
      "components/**/*.{tsx,ts,jsx,js}",
      "src/components/**/*.{tsx,ts,jsx,js}",
      "@ui/**/*.{tsx,ts,jsx,js}",
      "ui/**/*.{tsx,ts,jsx,js}",
    ]),
    appDirs: appResolution.candidateAppDirs,
  };

  logger.info(`App directory candidates: ${appResolution.candidateAppDirs.join(", ")}`);

  const session = new AnalysisSession({
    config,
    registry: IntelligenceRegistry.getInstance(),
    logger,
  });

  try {
    return await session.runDetailed();
  } finally {
    session.dispose();
  }
}

/**
 * Internal pipeline runner. Consumers should prefer {@link runIntelligencePipeline}
 * or {@link runIntelligencePipelineDetailed}; this entry point exists for the
 * {@link AnalysisSession} to invoke once setup is complete.
 */
export async function runIntelligencePipelineInternal(
  config: AnalyzerConfig,
  registry: IntelligenceRegistry,
  diagnosticsStore?: DiagnosticsStore,
  logger: Logger = consoleLogger
): Promise<PipelineRunResult> {
  registry.clear();
  registry.setProjectRoot(config.projectRoot);

  const totalStart = Date.now();
  const phases: PhaseTelemetry[] = [];
  const recordPhase = (
    phase: PhaseTelemetry["phase"],
    name: PhaseTelemetry["name"],
    startMs: number,
    counts: Record<string, number>
  ): void => {
    phases.push({ phase, name, durationMs: Date.now() - startMs, counts });
  };

  // Load incremental cache
  const cache = new IncrementalCache(config.cacheDir);
  // Snapshot of every file in the configured include globs, paired with its
  // current contents. Computed once when `incremental` is on; reused later
  // for the post-run cache update so we don't read the files twice.
  let fileSnapshot: { filePath: string; content: string }[] | null = null;
  let incrementalSummary: PipelineTelemetry["incremental"] | undefined;
  // Per-route reuse map, populated when `incremental:true` AND a prior
  // manifest is on disk AND the change frontier doesn't touch a given
  // route's `dependencyFiles`. Phase 5 short-circuits the recursive AST
  // traversal for each entry. Empty `Map` (or `null`) ⇒ no partial reuse.
  let reusableRoutes: Map<string, IntelligenceManifest["routeIntelligence"][string]> | null = null;

  if (config.incremental) {
    await cache.load();
    fileSnapshot = await collectFileSnapshot(config);
    const classification = cache.classifyChanges(fileSnapshot);
    const totalFiles = fileSnapshot.length;
    incrementalSummary = {
      cacheHit: false,
      totalFiles,
      addedFiles: classification.added.length,
      changedFiles: classification.changed.length,
      removedFiles: classification.removed.length,
      unchangedFiles: classification.unchanged.length,
    };

    const noChanges =
      classification.added.length === 0 &&
      classification.changed.length === 0 &&
      classification.removed.length === 0;

    if (noChanges && cache.hasPriorSnapshot()) {
      // Nothing on disk has changed since the last persisted run; try to
      // reuse the previously written manifest as-is. Falls back to a full
      // re-analysis if the manifest is missing or fails schema validation
      // (e.g. user deleted `.generated/`, manifest format bumped, etc.).
      const reused = await tryLoadCachedManifest(config.outputDir, logger);
      if (reused) {
        logger.info(
          `Incremental cache hit — reusing manifest (${totalFiles} files unchanged)`
        );
        incrementalSummary.cacheHit = true;
        const telemetry: PipelineTelemetry = {
          totalDurationMs: Date.now() - totalStart,
          phases: [],
          diagnostics: {
            error: (reused.diagnostics ?? []).filter((d) => d.severity === "error").length,
            warning: (reused.diagnostics ?? []).filter((d) => d.severity === "warning").length,
            info: (reused.diagnostics ?? []).filter((d) => d.severity === "info").length,
          },
          parse: { attempted: 0, succeeded: 0, failed: 0 },
          incremental: incrementalSummary,
        };
        return { manifest: reused, telemetry };
      }
      logger.info(
        "Incremental cache hit but no usable manifest on disk; running full pipeline."
      );
    }

    // ── Partial reuse path ────────────────────────────────────────────────
    // Some files changed (or no prior manifest), so we can't short-circuit
    // the whole pipeline. But we *can* still reuse `RouteIntelligence`
    // entries whose dependency-file set is untouched by the change frontier.
    // This skips the recursive AST traversal in Phase 5 — typically the
    // hottest phase for repos with deeply-nested route trees.
    if (!noChanges) {
      const prior = await tryLoadCachedManifest(config.outputDir, logger);
      if (prior?.routeIntelligence) {
        // Build the change frontier as project-relative POSIX paths so it
        // can be compared against `RouteIntelligence.dependencyFiles` (which
        // are also project-relative POSIX). Includes added + changed + removed.
        const toRel = (abs: string): string =>
          relative(config.projectRoot, abs).replace(/\\/g, "/");
        const changedRel = new Set<string>([
          ...classification.added.map(toRel),
          ...classification.changed.map(toRel),
          ...classification.removed.map(toRel),
        ]);

        reusableRoutes = new Map();
        for (const [routePath, intel] of Object.entries(prior.routeIntelligence)) {
          const deps = intel.dependencyFiles;
          // Skip entries that pre-date the dependencyFiles field; we have no
          // safe way to know whether they're affected.
          if (!deps || deps.length === 0) continue;
          const touched = deps.some((f) => changedRel.has(f));
          if (!touched) {
            reusableRoutes.set(routePath, intel);
          }
        }
        if (reusableRoutes.size > 0) {
          logger.info(
            `Incremental: reusing ${reusableRoutes.size}/${
              Object.keys(prior.routeIntelligence).length
            } route(s) from prior manifest`
          );
        }
      }
    }
  }

  // ── Phase 1: Raw AST Discovery + Symbol Resolution ──────
  logger.info("Phase 1: Analyzing components (symbol resolution)...");
  const phase1Start = Date.now();
  const analyzer = new ComponentAnalyzer(config);
  const { components, importEdges, renderEdges, project } = await analyzer.analyze();
  const parseFailures = analyzer.getParseFailures();
  logger.info(`  Found ${components.length} components`);
  if (parseFailures.length > 0) {
    logger.warn(`  Skipped ${parseFailures.length} unparseable file(s)`);
  }

  // Emit parse failures as diagnostics so they surface to consumers
  const parseDiagnostics: Diagnostic[] = parseFailures.map((failure) => ({
    category: "parse-error",
    severity: "warning",
    message: `Failed to parse source file: ${failure.reason}`,
    file: failure.filePath,
    context: { reason: failure.reason },
    suggestion:
      "Check the file for syntax errors. Common causes include unbalanced braces, " +
      "missing closing tags in JSX, or TypeScript syntax in a `.js` file. The " +
      "analyzer will skip this file but will continue with the rest of the project.",
    docUrl: "https://github.com/i2cinc/nextJs-intelligence#parse-error",
  }));
  diagnosticsStore?.addMany(parseDiagnostics);
  recordPhase(1, "discovery", phase1Start, {
    components: components.length,
    importEdges: importEdges.length,
    renderEdges: renderEdges.length,
    filesAttempted: analyzer.getFilesAttemptedCount(),
    filesParsed: analyzer.getFilesAddedCount(),
    parseFailures: parseFailures.length,
  });

  // ── Phase 2: Route Detection ────────────────────────────
  logger.info("Phase 2: Detecting routes...");
  const phase2Start = Date.now();
  const routes = await detectRoutes(config.projectRoot, config.appDirs ?? config.appDir);
  const apiRoutes = await detectApiRoutes(
    config.projectRoot,
    config.appDirs ?? config.appDir
  );
  const middleware = await detectMiddleware(config.projectRoot);
  const parallelSlots = await detectParallelSlots(
    config.projectRoot,
    config.appDirs ?? config.appDir
  );
  logger.info(
    `  Found ${routes.length} routes, ${apiRoutes.length} API routes, ` +
      `${parallelSlots.length} parallel slots, ${middleware.length} middleware`
  );
  recordPhase(2, "route-detection", phase2Start, {
    routes: routes.length,
    apiRoutes: apiRoutes.length,
    middleware: middleware.length,
    parallelSlots: parallelSlots.length,
  });

  // Detect server actions from the ts-morph project assembled in Phase 1.
  const serverActionDetector = new ServerActionDetector(project, config.projectRoot);
  const serverActions = serverActionDetector.detect();
  if (serverActions.length > 0) {
    logger.info(`  Detected ${serverActions.length} server action(s)`);
  }

  // Mark components whose source files contain at least one server action.
  const filesWithActions = serverActionDetector.getFilesWithActions();
  for (const component of components) {
    if (filesWithActions.has(component.relativePath)) {
      component.hasServerActions = true;
    }
  }

  // Register routes
  registry.registerRoutes(routes);

  // ── Phase 3: Composite Ownership Resolution ─────────────
  logger.info("Phase 3: Detecting composite components (semantic-first)...");
  const phase3Start = Date.now();
  const composites = CompositeDetector.detect(project, components);
  CompositeDetector.applyToComponents(components, composites);
  const compositeCount = composites.size;
  const subCount = Array.from(composites.values()).reduce(
    (sum, g) => sum + g.subComponents.length,
    0
  );
  logger.info(
    `  Found ${compositeCount} composite components with ${subCount} sub-components`
  );

  // Log composite confidence
  for (const [name, group] of composites) {
    const conf = group.confidence;
    logger.info(
      `    ${name}: confidence=${conf.score.toFixed(2)} evidence=[${conf.evidence.join(", ")}]`
    );
  }
  recordPhase(3, "composite-detection", phase3Start, {
    composites: compositeCount,
    subComponents: subCount,
  });

  // ── Phase 4: Canonicalization ───────────────────────────
  logger.info("Phase 4: Canonicalizing component identities...");
  const phase4Start = Date.now();
  const canonicalization = Canonicalizer.canonicalize(components, composites);
  const canonicalComponents = canonicalization.components;
  logger.info(
    `  Canonicalized ${canonicalComponents.length} components, ${canonicalization.subComponentNames.size} sub-component names mapped`
  );

  // Register canonicalized components
  registry.registerComponents(canonicalComponents);
  recordPhase(4, "canonicalization", phase4Start, {
    components: canonicalComponents.length,
    subComponentNames: canonicalization.subComponentNames.size,
  });

  // ── Phase 5: Route Intelligence ─────────────────────────
  logger.info("Phase 5: Building route intelligence...");
  const phase5Start = Date.now();
  const routeIntelBuilder = new RouteIntelligenceBuilder(
    project,
    config.projectRoot,
    canonicalComponents,
    composites
  );
  const { routeIntelligence, componentUsage, updatedComponents } =
    routeIntelBuilder.build(routes, canonicalComponents, reusableRoutes ?? undefined);

  // Re-register updated components (with usedInRoutes populated)
  registry.registerComponents(updatedComponents);
  registry.registerRouteIntelligence(routeIntelligence);
  registry.registerComponentUsage(componentUsage);

  const routeCount = Object.keys(routeIntelligence).length;
  const reusedRouteCount = routeIntelBuilder.getReusedRouteCount();
  if (reusedRouteCount > 0) {
    logger.info(
      `  Reused ${reusedRouteCount}/${routeCount} route intelligence entries from cache`
    );
  }
  if (incrementalSummary) {
    incrementalSummary.reusedRoutes = reusedRouteCount;
  }
  const totalDeps = Object.values(routeIntelligence).reduce(
    (sum, ri) => sum + ri.dependencyCount,
    0
  );
  logger.info(
    `  Analyzed ${routeCount} routes, ${totalDeps} total dependencies`
  );
  const traversalStats = routeIntelBuilder.getTraversalCacheStats();
  if (traversalStats.hits + traversalStats.misses > 0) {
    const hitRate = (
      (traversalStats.hits / (traversalStats.hits + traversalStats.misses)) *
      100
    ).toFixed(1);
    logger.info(
      `  Traversal cache: ${traversalStats.hits} hits / ${traversalStats.misses} misses (${hitRate}% hit rate)`
    );
  }
  recordPhase(5, "route-intelligence", phase5Start, {
    routes: routeCount,
    totalDependencies: totalDeps,
    traversalCacheHits: traversalStats.hits,
    traversalCacheMisses: traversalStats.misses,
    reusedRoutes: reusedRouteCount,
  });

  // ── Phase 6: Graph Construction (Separated) ─────────────
  logger.info("Phase 6: Building dependency graphs (separated)...");
  const phase6Start = Date.now();
  const graphBuilder = new GraphBuilder();
  graphBuilder.addComponents(updatedComponents);
  graphBuilder.addRoutes(routes, updatedComponents);
  graphBuilder.addImportEdges(importEdges);
  graphBuilder.addRenderEdges(renderEdges);
  graphBuilder.addCompositeOwnership(composites, updatedComponents);
  graphBuilder.addReusabilityEdges(updatedComponents);

  const separatedGraphs = graphBuilder.buildSeparated();
  const unifiedGraph = graphBuilder.build();

  // Add unified graph edges to registry
  registry.addEdges(unifiedGraph.edges);

  logger.info(
    `  Import edges: ${separatedGraphs.import.edges.length}, ` +
    `Render edges: ${separatedGraphs.render.edges.length}, ` +
    `Ownership edges: ${separatedGraphs.compositeOwnership.edges.length}`
  );
  recordPhase(6, "graph-build", phase6Start, {
    importEdges: separatedGraphs.import.edges.length,
    renderEdges: separatedGraphs.render.edges.length,
    ownershipEdges: separatedGraphs.compositeOwnership.edges.length,
    runtimeMountEdges: separatedGraphs.runtimeMount.edges.length,
    unifiedEdges: unifiedGraph.edges.length,
  });

  // ── Phase 7: Verification Passes ────────────────────────
  logger.info("Phase 7: Running verification passes...");
  const phase7Start = Date.now();
  const verifier = new VerificationPass();
  const verificationDiagnostics = verifier.verify({
    components: updatedComponents,
    routes,
    graphs: separatedGraphs,
    unifiedGraph,
    composites,
  });
  diagnosticsStore?.addMany(verificationDiagnostics);

  // Load bundle stats up-front so budget diagnostics participate in the same
  // diagnostics array (and counts) as verification output. Best-effort:
  // missing `.next/app-build-manifest.json` is fine, but an explicit
  // `bundleStatsPath` that can't be read is fatal.
  let bundleStats: Awaited<ReturnType<typeof loadBundleStats>> = null;
  try {
    bundleStats = await loadBundleStats(config.projectRoot, config.bundleStatsPath);
  } catch (err) {
    logger.warn(
      `Bundle stats load failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Bundle-budget diagnostics are opt-in: emitted only when a budget is
  // configured and bundle stats are available. Keeps default runs unchanged.
  const bundleDiagnostics: Diagnostic[] =
    bundleStats && config.bundleBudget
      ? deriveBundleDiagnostics(bundleStats, config.bundleBudget)
      : [];
  if (bundleDiagnostics.length > 0) {
    diagnosticsStore?.addMany(bundleDiagnostics);
  }

  // Combined diagnostics include parse-error diagnostics emitted in Phase 1
  const diagnostics: Diagnostic[] = [
    ...parseDiagnostics,
    ...verificationDiagnostics,
    ...bundleDiagnostics,
  ];

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");
  logger.info(
    `  Diagnostics: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info`
  );

  for (const diag of errors) {
    logger.error(`  ERROR: ${diag.message}`);
  }
  for (const diag of warnings) {
    logger.warn(`  WARN: ${diag.message}`);
  }
  recordPhase(7, "verification", phase7Start, {
    errors: errors.length,
    warnings: warnings.length,
    infos: infos.length,
  });

  // ── Phase 8: Export Manifest + Write ────────────────────
  logger.info("Phase 8: Writing output files...");
  const phase8Start = Date.now();
  const manifest = registry.exportManifest();

  // Attach separated graphs, diagnostics, and Phase-C collections
  manifest.graphs = separatedGraphs;
  manifest.diagnostics = diagnostics;
  manifest.apiRoutes = apiRoutes;
  manifest.middleware = middleware;
  manifest.parallelSlots = parallelSlots;
  manifest.serverActions = serverActions;

  // Patch summary counts that depend on Phase-2 collections (registry doesn't see them)
  manifest.summary.apiRoutes = apiRoutes.length;
  manifest.summary.middlewareCount = middleware.length;
  manifest.summary.parallelSlots = parallelSlots.length;
  manifest.summary.serverActions = serverActions.length;

  // Compute derived metrics. Bundle stats were loaded earlier (so budget
  // diagnostics could join the diagnostics array); reuse them here for the
  // per-route `bundle` join and aggregate `derived.bundle` block.
  manifest.derived = deriveMetrics(manifest, bundleStats ?? undefined);
  if (bundleStats) {
    logger.info(
      `  Merged bundle stats from ${bundleStats.source} (${
        Object.keys(bundleStats.routes).length
      } route(s))`
    );
  }

  const writer = new OutputWriter(config.outputDir);
  await writer.writeAll(manifest);

  // Save incremental cache: snapshot the files we just analyzed so the next
  // run can short-circuit if nothing changes. Use the snapshot collected
  // up-front (avoids a second pass of I/O). If the snapshot wasn't taken
  // (incremental disabled), skip persistence entirely — there's nothing to
  // compare against on the next run.
  if (config.incremental && fileSnapshot) {
    cache.replaceAll(fileSnapshot);
    await cache.save();
  }

  logger.info(`Output written to ${config.outputDir}`);
  logger.info(`Summary: ${JSON.stringify(manifest.summary)}`);
  recordPhase(8, "output", phase8Start, {
    components: Object.keys(manifest.components).length,
    routes: manifest.routes.length,
  });

  const telemetry: PipelineTelemetry = {
    totalDurationMs: Date.now() - totalStart,
    phases,
    diagnostics: { error: errors.length, warning: warnings.length, info: infos.length },
    parse: {
      attempted: analyzer.getFilesAttemptedCount(),
      succeeded: analyzer.getFilesAddedCount(),
      failed: parseFailures.length,
    },
    incremental: incrementalSummary,
  };

  return { manifest, telemetry };
}

/**
 * Read every file matching the analyzer's include globs and return their
 * absolute path + contents. Mirrors {@link ComponentAnalyzer.discoverFiles}
 * so cache classification operates on the same file set that will actually
 * be parsed. Kept in the pipeline (rather than reused from the analyzer)
 * because we need the contents *before* constructing the analyzer/session.
 */
async function collectFileSnapshot(
  config: AnalyzerConfig
): Promise<{ filePath: string; content: string }[]> {
  const normalizedRoot = config.projectRoot.replace(/\\/g, "/");
  const filePaths = await fg(config.include, {
    cwd: normalizedRoot,
    absolute: true,
    ignore: [
      ...config.exclude,
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.generated/**",
    ],
    onlyFiles: true,
  });
  // Read in parallel; individual failures fall back to empty content so the
  // hash still differs from the cached value and the file is treated as
  // changed (forcing a full re-analysis that will surface the real error).
  return Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return { filePath, content: await readFile(filePath, "utf-8") };
      } catch {
        return { filePath, content: "" };
      }
    })
  );
}

/**
 * Load and validate the manifest written by a previous run. Returns `null`
 * if the file is missing, unreadable, malformed, or fails schema validation
 * (in which case the caller should fall through to a full pipeline run).
 */
async function tryLoadCachedManifest(
  outputDir: string,
  logger: Logger
): Promise<IntelligenceManifest | null> {
  const manifestPath = resolve(outputDir, "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.valid) {
      logger.warn(
        `Cached manifest at ${manifestPath} failed schema validation; re-running pipeline. ` +
          `(${result.errors.length} schema errors)`
      );
      return null;
    }
    return parsed as IntelligenceManifest;
  } catch {
    return null;
  }
}
