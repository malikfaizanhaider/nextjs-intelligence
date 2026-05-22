import { resolve } from "node:path";
import type { AnalyzerConfig, IntelligenceManifest, Diagnostic } from "@i2c/intelligence-types";
import { IntelligenceRegistry } from "./registry";
import { ComponentAnalyzer } from "./analyzer/component-analyzer";
import { detectRoutes } from "./analyzer/route-detector";
import { GraphBuilder } from "./analyzer/graph-builder";
import { RouteIntelligenceBuilder } from "./analyzer/route-intelligence-builder";
import { CompositeDetector } from "./analyzer/composite-detector";
import { Canonicalizer } from "./analyzer/canonicalizer";
import { VerificationPass } from "./analyzer/verification";
import { OutputWriter } from "./output-writer";
import { IncrementalCache } from "./cache";

const DEFAULT_CONFIG: AnalyzerConfig = {
  projectRoot: process.cwd(),
  include: ["app/**/*.{tsx,ts}", "components/**/*.{tsx,ts}", "@ui/**/*.{tsx,ts}", "ui/**/*.{tsx,ts}"],
  exclude: ["**/*.test.*", "**/*.spec.*", "**/*.stories.*", "**/__tests__/**"],
  appDir: "app",
  outputDir: ".generated/intelligence",
  incremental: true,
  cacheDir: "node_modules/.cache/intelligence",
};

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
  userConfig: Partial<AnalyzerConfig> = {}
): Promise<IntelligenceManifest> {
  const config: AnalyzerConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    projectRoot: resolve(userConfig.projectRoot ?? DEFAULT_CONFIG.projectRoot),
    outputDir: resolve(
      userConfig.projectRoot ?? DEFAULT_CONFIG.projectRoot,
      userConfig.outputDir ?? DEFAULT_CONFIG.outputDir
    ),
    cacheDir: resolve(
      userConfig.projectRoot ?? DEFAULT_CONFIG.projectRoot,
      userConfig.cacheDir ?? DEFAULT_CONFIG.cacheDir
    ),
  };

  const registry = IntelligenceRegistry.getInstance();
  registry.clear();
  registry.setProjectRoot(config.projectRoot);

  // Load incremental cache
  const cache = new IncrementalCache(config.cacheDir);
  if (config.incremental) {
    await cache.load();
  }

  // ── Phase 1: Raw AST Discovery + Symbol Resolution ──────
  console.log("[intelligence] Phase 1: Analyzing components (symbol resolution)...");
  const analyzer = new ComponentAnalyzer(config);
  const { components, importEdges, renderEdges, project } = await analyzer.analyze();
  console.log(`[intelligence]   Found ${components.length} components`);

  // ── Phase 2: Route Detection ────────────────────────────
  console.log("[intelligence] Phase 2: Detecting routes...");
  const routes = await detectRoutes(config.projectRoot, config.appDir);
  console.log(`[intelligence]   Found ${routes.length} routes`);

  // Register routes
  registry.registerRoutes(routes);

  // ── Phase 3: Composite Ownership Resolution ─────────────
  console.log("[intelligence] Phase 3: Detecting composite components (semantic-first)...");
  const composites = CompositeDetector.detect(project, components);
  CompositeDetector.applyToComponents(components, composites);
  const compositeCount = composites.size;
  const subCount = Array.from(composites.values()).reduce(
    (sum, g) => sum + g.subComponents.length,
    0
  );
  console.log(
    `[intelligence]   Found ${compositeCount} composite components with ${subCount} sub-components`
  );

  // Log composite confidence
  for (const [name, group] of composites) {
    const conf = group.confidence;
    console.log(
      `[intelligence]     ${name}: confidence=${conf.score.toFixed(2)} evidence=[${conf.evidence.join(", ")}]`
    );
  }

  // ── Phase 4: Canonicalization ───────────────────────────
  console.log("[intelligence] Phase 4: Canonicalizing component identities...");
  const canonicalization = Canonicalizer.canonicalize(components, composites);
  const canonicalComponents = canonicalization.components;
  console.log(
    `[intelligence]   Canonicalized ${canonicalComponents.length} components, ${canonicalization.subComponentNames.size} sub-component names mapped`
  );

  // Register canonicalized components
  registry.registerComponents(canonicalComponents);

  // ── Phase 5: Route Intelligence ─────────────────────────
  console.log("[intelligence] Phase 5: Building route intelligence...");
  const routeIntelBuilder = new RouteIntelligenceBuilder(
    project,
    config.projectRoot,
    canonicalComponents,
    composites
  );
  const { routeIntelligence, componentUsage, updatedComponents } =
    routeIntelBuilder.build(routes, canonicalComponents);

  // Re-register updated components (with usedInRoutes populated)
  registry.registerComponents(updatedComponents);
  registry.registerRouteIntelligence(routeIntelligence);
  registry.registerComponentUsage(componentUsage);

  const routeCount = Object.keys(routeIntelligence).length;
  const totalDeps = Object.values(routeIntelligence).reduce(
    (sum, ri) => sum + ri.dependencyCount,
    0
  );
  console.log(
    `[intelligence]   Analyzed ${routeCount} routes, ${totalDeps} total dependencies`
  );

  // ── Phase 6: Graph Construction (Separated) ─────────────
  console.log("[intelligence] Phase 6: Building dependency graphs (separated)...");
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

  console.log(
    `[intelligence]   Import edges: ${separatedGraphs.import.edges.length}, ` +
    `Render edges: ${separatedGraphs.render.edges.length}, ` +
    `Ownership edges: ${separatedGraphs.compositeOwnership.edges.length}`
  );

  // ── Phase 7: Verification Passes ────────────────────────
  console.log("[intelligence] Phase 7: Running verification passes...");
  const verifier = new VerificationPass();
  const diagnostics = verifier.verify({
    components: updatedComponents,
    routes,
    graphs: separatedGraphs,
    unifiedGraph,
    composites,
  });

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");
  console.log(
    `[intelligence]   Diagnostics: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info`
  );

  for (const diag of errors) {
    console.error(`[intelligence]   ERROR: ${diag.message}`);
  }
  for (const diag of warnings) {
    console.warn(`[intelligence]   WARN: ${diag.message}`);
  }

  // ── Phase 8: Export Manifest + Write ────────────────────
  console.log("[intelligence] Phase 8: Writing output files...");
  const manifest = registry.exportManifest();

  // Attach separated graphs and diagnostics
  manifest.graphs = separatedGraphs;
  manifest.diagnostics = diagnostics;

  const writer = new OutputWriter(config.outputDir);
  await writer.writeAll(manifest);

  // Save incremental cache
  if (config.incremental) {
    await cache.save();
  }

  console.log(`[intelligence] Output written to ${config.outputDir}`);
  console.log("[intelligence] Summary:", JSON.stringify(manifest.summary, null, 2));

  return manifest;
}
