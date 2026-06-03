import { promises as fs } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type {
  BundleStats,
  BundleBudget,
  ComponentDerivedMetrics,
  ConfidenceHistogram,
  DerivedMetrics,
  Diagnostic,
  IntelligenceManifest,
  RouteBundleStats,
  RouteDerivedMetrics,
} from "../../intelligence-types/src/index";
import { DERIVED_METRICS_VERSION } from "../../intelligence-types/src/index";

/** Cap for `topReusable` and `hotspotRoutes` arrays in derived output. */
const TOP_N = 20;

/**
 * Pure, deterministic derivation of cheap analytics from an
 * {@link IntelligenceManifest}. Safe to call multiple times; no I/O.
 *
 * `bundleStats` is optional — when present, per-route `bundle` and the
 * aggregate `derived.bundle` block are populated.
 */
export function deriveMetrics(
  manifest: IntelligenceManifest,
  bundleStats?: BundleStats
): DerivedMetrics {
  const componentMetrics = computeComponentMetrics(manifest);
  const routeMetrics = computeRouteMetrics(manifest, bundleStats);

  const deadComponents = Object.values(componentMetrics)
    .filter((c) => c.isDead)
    .map((c) => c.canonicalId)
    .sort((a, b) => a.localeCompare(b));

  const reusableComponents = Object.values(componentMetrics).filter(
    (c) => c.reusabilityScore >= 0.2
  ).length;

  const topReusable = Object.values(componentMetrics)
    .filter((c) => !c.isDead)
    .sort((a, b) => b.reusabilityScore - a.reusabilityScore || a.canonicalId.localeCompare(b.canonicalId))
    .slice(0, TOP_N);

  const hotspotRoutes = Object.values(routeMetrics)
    .sort((a, b) => b.hotness - a.hotness || a.path.localeCompare(b.path))
    .slice(0, TOP_N);

  const confidenceHistogram = computeConfidenceHistogram(manifest);
  const componentCount = Object.keys(componentMetrics).length;
  const diagnosticDensity =
    componentCount === 0 ? 0 : round(manifest.diagnostics.length / componentCount, 4);

  const derived: DerivedMetrics = {
    version: DERIVED_METRICS_VERSION,
    totals: {
      components: componentCount,
      routes: Object.keys(routeMetrics).length,
      deadComponents: deadComponents.length,
      reusableComponents,
      diagnostics: manifest.diagnostics.length,
    },
    diagnosticDensity,
    confidenceHistogram,
    topReusable,
    hotspotRoutes,
    deadComponents,
    components: componentMetrics,
    routes: routeMetrics,
  };

  if (bundleStats) {
    const routesWithStats = Object.values(routeMetrics).filter((r) => r.bundle).length;
    derived.bundle = {
      source: bundleStats.source,
      totalJsBytes: bundleStats.totalJsBytes,
      totalCssBytes: bundleStats.totalCssBytes,
      routesWithStats,
    };
  }

  return derived;
}

/**
 * Pure, deterministic derivation of bundle-budget diagnostics from bundle
 * stats. Returns an empty array unless at least one budget threshold is set
 * AND a route exceeds it — so default (budget-free) runs stay diagnostic-free.
 *
 * No I/O. Routes are evaluated in sorted path order so the emitted diagnostic
 * array is byte-stable across runs and platforms.
 */
export function deriveBundleDiagnostics(
  bundleStats: BundleStats,
  budget: BundleBudget
): Diagnostic[] {
  const { maxRouteJsBytes, maxRouteCssBytes, maxFirstLoadJsBytes } = budget;
  const hasBudget =
    typeof maxRouteJsBytes === "number" ||
    typeof maxRouteCssBytes === "number" ||
    typeof maxFirstLoadJsBytes === "number";
  if (!hasBudget) return [];

  const diagnostics: Diagnostic[] = [];
  const paths = Object.keys(bundleStats.routes).sort((a, b) => a.localeCompare(b));

  for (const path of paths) {
    const route = bundleStats.routes[path];

    if (typeof maxRouteJsBytes === "number" && route.jsBytes > maxRouteJsBytes) {
      diagnostics.push({
        category: "oversized-route",
        severity: "warning",
        message: `Route "${path}" ships ${route.jsBytes} JS bytes, exceeding the budget of ${maxRouteJsBytes}.`,
        nodeId: `route::${path}`,
        context: { path, jsBytes: route.jsBytes, budget: maxRouteJsBytes, metric: "jsBytes" },
        suggestion:
          "Code-split heavy dependencies with next/dynamic or move logic to a server component to reduce the route's JavaScript payload.",
      });
    }

    if (
      typeof maxFirstLoadJsBytes === "number" &&
      typeof route.firstLoadJs === "number" &&
      route.firstLoadJs > maxFirstLoadJsBytes
    ) {
      diagnostics.push({
        category: "oversized-route",
        severity: "warning",
        message: `Route "${path}" has a first-load JS of ${route.firstLoadJs} bytes, exceeding the budget of ${maxFirstLoadJsBytes}.`,
        nodeId: `route::${path}`,
        context: {
          path,
          firstLoadJs: route.firstLoadJs,
          budget: maxFirstLoadJsBytes,
          metric: "firstLoadJs",
        },
        suggestion:
          "Reduce shared first-load chunks by lazy-loading non-critical providers and trimming the route's eager import graph.",
      });
    }

    if (typeof maxRouteCssBytes === "number" && route.cssBytes > maxRouteCssBytes) {
      diagnostics.push({
        category: "oversized-route",
        severity: "info",
        message: `Route "${path}" ships ${route.cssBytes} CSS bytes, exceeding the budget of ${maxRouteCssBytes}.`,
        nodeId: `route::${path}`,
        context: { path, cssBytes: route.cssBytes, budget: maxRouteCssBytes, metric: "cssBytes" },
        suggestion:
          "Audit global stylesheets and prefer scoped CSS modules to shrink the route's CSS payload.",
      });
    }
  }

  return diagnostics;
}

// ─── Component metrics ──────────────────────────────────────

function computeComponentMetrics(
  manifest: IntelligenceManifest
): Record<string, ComponentDerivedMetrics> {
  const components = manifest.components ?? {};
  const usage = manifest.componentUsage ?? {};
  const runtime = manifest.runtime ?? {};

  // Build a fan-in map from the import graph. usedInFiles in ComponentMeta is
  // already populated by the analyzer, but we recompute from the graph for
  // resilience against manifests with stale meta.
  const fanInByTarget = new Map<string, Set<string>>();
  for (const edge of manifest.graph?.edges ?? []) {
    if (edge.relationship !== "imports") continue;
    let bucket = fanInByTarget.get(edge.target);
    if (!bucket) {
      bucket = new Set();
      fanInByTarget.set(edge.target, bucket);
    }
    bucket.add(edge.source);
  }

  const out: Record<string, ComponentDerivedMetrics> = {};
  for (const [id, meta] of Object.entries(components)) {
    const usageEntry = usage[id];
    const routeCount = usageEntry?.usedInRoutes.length ?? meta.usedInRoutes?.length ?? 0;
    const fanInFromGraph = fanInByTarget.get(id)?.size ?? 0;
    const fanInFromMeta = meta.usedInFiles?.length ?? 0;
    const fanIn = Math.max(fanInFromGraph, fanInFromMeta);
    const fanOut = meta.imports?.length ?? 0;
    const jsxChildCount = meta.jsxChildren?.length ?? 0;
    const isDead = fanIn === 0 && routeCount === 0;

    out[id] = {
      canonicalId: id,
      fanIn,
      fanOut,
      routeCount,
      jsxChildCount,
      reusabilityScore: round(reusabilityScore(routeCount, fanIn), 4),
      isDead,
      hasRuntime: Boolean(runtime[id]),
    };
  }
  return out;
}

/**
 * Log-dampened reusability score in 0..1.
 *
 * - Route breadth weighted higher than file breadth (routes ≈ user-visible reuse).
 * - log1p prevents one ultra-shared primitive from saturating the rest.
 */
function reusabilityScore(routeCount: number, fanIn: number): number {
  const routeTerm = Math.log1p(routeCount) / Math.log1p(10); // saturates ~10 routes
  const fileTerm = Math.log1p(fanIn) / Math.log1p(20); // saturates ~20 importers
  const combined = 0.65 * routeTerm + 0.35 * fileTerm;
  return clamp01(combined);
}

// ─── Route metrics ──────────────────────────────────────────

function computeRouteMetrics(
  manifest: IntelligenceManifest,
  bundleStats?: BundleStats
): Record<string, RouteDerivedMetrics> {
  const routeIntel = manifest.routeIntelligence ?? {};
  const components = manifest.components ?? {};
  const runtime = manifest.runtime ?? {};
  const routeMeta = new Map<string, IntelligenceManifest["routes"][number]>();
  for (const r of manifest.routes ?? []) routeMeta.set(r.path, r);

  const entries = Object.entries(routeIntel);
  const maxComplexity = computeMaxComplexity(entries);
  const { mountTotals, maxMounts } = computeRouteMountTotals(runtime);
  const componentsByName = indexComponentsByName(components);

  const out: Record<string, RouteDerivedMetrics> = {};
  for (const [path, intel] of entries) {
    out[path] = buildRouteDerived({
      path,
      intel,
      maxComplexity,
      mountTotal: mountTotals.get(path) ?? 0,
      maxMounts,
      componentsByName,
      meta: routeMeta.get(path),
      bundle: bundleStats?.routes[path],
    });
  }
  return out;
}

function computeMaxComplexity(
  entries: [string, IntelligenceManifest["routeIntelligence"][string]][]
): number {
  let max = 0;
  for (const [, intel] of entries) {
    const score = (intel.complexity?.components ?? 0) + (intel.complexity?.dependencies ?? 0);
    if (score > max) max = score;
  }
  return max;
}

function computeRouteMountTotals(
  runtime: IntelligenceManifest["runtime"]
): { mountTotals: Map<string, number>; maxMounts: number } {
  const mountTotals = new Map<string, number>();
  for (const meta of Object.values(runtime)) {
    for (const route of meta.mountedOnRoutes ?? []) {
      mountTotals.set(route, (mountTotals.get(route) ?? 0) + meta.mountCount);
    }
  }
  let maxMounts = 0;
  for (const v of mountTotals.values()) if (v > maxMounts) maxMounts = v;
  return { mountTotals, maxMounts };
}

function indexComponentsByName(
  components: IntelligenceManifest["components"]
): Map<string, IntelligenceManifest["components"][string]> {
  const map = new Map<string, IntelligenceManifest["components"][string]>();
  for (const c of Object.values(components)) {
    if (!map.has(c.name)) map.set(c.name, c);
  }
  return map;
}

interface RouteDerivedInput {
  path: string;
  intel: IntelligenceManifest["routeIntelligence"][string];
  maxComplexity: number;
  mountTotal: number;
  maxMounts: number;
  componentsByName: Map<string, IntelligenceManifest["components"][string]>;
  meta: IntelligenceManifest["routes"][number] | undefined;
  bundle: RouteBundleStats | undefined;
}

function buildRouteDerived(input: RouteDerivedInput): RouteDerivedMetrics {
  const { path, intel, maxComplexity, mountTotal, maxMounts, componentsByName, meta, bundle } =
    input;

  const total = intel.components?.length ?? 0;
  const lazy = intel.lazyComponents?.length ?? 0;
  const lazyRatio = total === 0 ? 0 : lazy / total;
  const bundleRisk = 1 - lazyRatio;
  const clientComponentRatio = computeClientRatio(intel.components ?? [], componentsByName);

  const complexityRaw =
    (intel.complexity?.components ?? 0) + (intel.complexity?.dependencies ?? 0);
  const complexityScore = maxComplexity === 0 ? 0 : clamp01(complexityRaw / maxComplexity);

  const mountScore = maxMounts === 0 ? 0 : mountTotal / maxMounts;
  // When no runtime data exists at all (maxMounts=0), fall back to pure
  // complexity so hotness is still meaningful in static-only runs.
  const hotness =
    maxMounts === 0
      ? complexityScore
      : clamp01(0.6 * complexityScore + 0.4 * mountScore);

  const hasNotFound = Boolean(
    meta && /not-found\.(tsx?|jsx?)$/i.test(meta.relativePath ?? "")
  );

  const entry: RouteDerivedMetrics = {
    path,
    complexityScore: round(complexityScore, 4),
    lazyRatio: round(lazyRatio, 4),
    bundleRisk: round(bundleRisk, 4),
    hasErrorBoundary: Boolean(intel.errorFilePath),
    hasLoading: Boolean(intel.loadingFilePath),
    hasNotFound,
    clientComponentRatio: round(clientComponentRatio, 4),
    hotness: round(hotness, 4),
  };
  if (bundle) entry.bundle = bundle;
  return entry;
}

function computeClientRatio(
  componentNames: string[],
  componentsByName: Map<string, IntelligenceManifest["components"][string]>
): number {
  let clientCount = 0;
  let resolved = 0;
  for (const name of componentNames) {
    const c = componentsByName.get(name);
    if (!c) continue;
    resolved += 1;
    if (c.rendering === "client") clientCount += 1;
  }
  return resolved === 0 ? 0 : clientCount / resolved;
}

// ─── Confidence histogram ───────────────────────────────────

function computeConfidenceHistogram(manifest: IntelligenceManifest): ConfidenceHistogram {
  const hist: ConfidenceHistogram = { high: 0, medium: 0, low: 0 };
  for (const edge of manifest.graph?.edges ?? []) {
    const score = edge.confidence?.score;
    if (typeof score !== "number") continue;
    if (score >= 0.8) hist.high += 1;
    else if (score >= 0.5) hist.medium += 1;
    else hist.low += 1;
  }
  return hist;
}

// ─── Utilities ──────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

// ─── Bundle stats loader ────────────────────────────────────

/**
 * Best-effort load of bundle stats for the project. Returns `null` when no
 * usable data is found; never throws on missing files. Tried in order:
 *
 *   1. If `explicitPath` is provided, load it as either a {@link BundleStats}
 *      document or a Next.js `app-build-manifest.json` (auto-detected by
 *      shape). Throws when the file exists but cannot be parsed — that's a
 *      configuration error and should fail loudly.
 *   2. Otherwise probe `.next/app-build-manifest.json` under `projectRoot`.
 */
export async function loadBundleStats(
  projectRoot: string,
  explicitPath?: string
): Promise<BundleStats | null> {
  if (explicitPath) {
    const absolute = resolve(projectRoot, explicitPath);
    const stats = await loadFromPath(absolute, projectRoot, /* strict */ true);
    return stats;
  }

  const defaultPath = resolve(projectRoot, ".next/app-build-manifest.json");
  return loadFromPath(defaultPath, projectRoot, /* strict */ false);
}

async function loadFromPath(
  absolute: string,
  projectRoot: string,
  strict: boolean
): Promise<BundleStats | null> {
  let raw: string;
  try {
    raw = await fs.readFile(absolute, "utf-8");
  } catch {
    if (strict) {
      throw new Error(`[intelligence] Bundle stats file not found: ${absolute}`);
    }
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `[intelligence] Failed to parse bundle stats at ${absolute}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }

  if (isBundleStats(parsed)) {
    return parsed;
  }
  if (isNextAppBuildManifest(parsed)) {
    return convertNextManifest(parsed, absolute, projectRoot);
  }

  if (strict) {
    throw new Error(
      `[intelligence] Bundle stats at ${absolute} is neither a BundleStats document nor a Next.js app-build-manifest.json`
    );
  }
  return null;
}

function isBundleStats(value: unknown): value is BundleStats {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.source === "string" &&
    typeof v.totalJsBytes === "number" &&
    typeof v.totalCssBytes === "number" &&
    typeof v.routes === "object" &&
    v.routes !== null
  );
}

interface NextAppBuildManifest {
  pages: Record<string, string[]>;
}

function isNextAppBuildManifest(value: unknown): value is NextAppBuildManifest {
  if (!value || typeof value !== "object") return false;
  const pages = (value as Record<string, unknown>).pages;
  if (!pages || typeof pages !== "object") return false;
  // Sample first entry to confirm `{ [routeKey]: string[] }`.
  const sample = Object.values(pages as Record<string, unknown>)[0];
  if (sample === undefined) return true;
  if (!Array.isArray(sample)) return false;
  return sample.length === 0 || typeof sample[0] === "string";
}

/**
 * Convert a Next.js `app-build-manifest.json` to {@link BundleStats}.
 * File sizes are read from disk relative to the manifest's parent directory
 * (typically `.next/`). Missing files contribute 0 bytes — they're logged
 * via the chunk id but don't fail the conversion.
 */
async function convertNextManifest(
  parsed: NextAppBuildManifest,
  manifestPath: string,
  projectRoot: string
): Promise<BundleStats> {
  const nextDir = dirname(manifestPath);
  const routes: Record<string, RouteBundleStats> = {};
  let totalJs = 0;
  let totalCss = 0;

  // Cache file sizes so shared chunks aren't statted repeatedly.
  const sizeCache = new Map<string, number>();
  const sizeOf = async (relativePath: string): Promise<number> => {
    const cached = sizeCache.get(relativePath);
    if (cached !== undefined) return cached;
    try {
      const stat = await fs.stat(join(nextDir, relativePath));
      sizeCache.set(relativePath, stat.size);
      return stat.size;
    } catch {
      sizeCache.set(relativePath, 0);
      return 0;
    }
  };

  for (const [routeKey, chunks] of Object.entries(parsed.pages)) {
    const path = normalizeNextRouteKey(routeKey);
    let jsBytes = 0;
    let cssBytes = 0;
    for (const chunk of chunks) {
      const size = await sizeOf(chunk);
      if (chunk.endsWith(".css")) cssBytes += size;
      else jsBytes += size;
    }
    routes[path] = {
      path,
      jsBytes,
      cssBytes,
      chunkIds: chunks,
    };
    totalJs += jsBytes;
    totalCss += cssBytes;
  }

  return {
    source: `next/app-build-manifest.json (${shortenPath(manifestPath, projectRoot)})`,
    totalJsBytes: totalJs,
    totalCssBytes: totalCss,
    routes,
  };
}

/**
 * Convert Next.js route keys like `/page`, `/users/[id]/page`,
 * `/(group)/dashboard/page` into the canonical URL paths used by
 * {@link RouteMeta.path}. Mirrors the convention used by the route detector.
 */
function normalizeNextRouteKey(key: string): string {
  // Strip trailing `/page` segment if present.
  let path = key.replace(/\/page$/, "");
  // Strip route-group segments `(group)`.
  path = path.replace(/\/\([^)]+\)/g, "");
  if (path === "" || path === "/") return "/";
  return path;
}

function shortenPath(absolute: string, projectRoot: string): string {
  if (absolute.startsWith(projectRoot)) {
    return absolute.slice(projectRoot.length).replace(/^[/\\]+/, "");
  }
  return absolute;
}
