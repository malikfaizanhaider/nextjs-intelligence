/**
 * Component classification types.
 */
export type ComponentType =
  | "component"
  | "page"
  | "layout"
  | "dialog"
  | "grid"
  | "chart"
  | "provider"
  | "template"
  | "loading"
  | "error"
  | "hook"
  | "util";

/**
 * Rendering environment for a component.
 */
export type RenderingEnvironment = "client" | "server";

// ─── Canonical Identity ────────────────────────────────────

/**
 * Canonical identity for a component.
 * This is the ONLY way to identify a component across the system.
 * Prevents duplicate collisions, incorrect reuse detection, and graph contamination.
 *
 * Format: `sourceFile#exportName`
 * Example: `src/components/data-grid/index.tsx#DataGrid`
 */
export interface CanonicalIdentity {
  /** Stable canonical ID: `relativePath#exportName` */
  canonicalId: string;
  /** Relative source file path from project root */
  sourceFile: string;
  /** The export symbol name as declared in source */
  exportName: string;
  /** Absolute file path */
  absolutePath: string;
  /** If this component is a sub-component, the canonical ID of its composite root */
  compositeRoot: string | null;
}

// ─── Confidence Scoring ────────────────────────────────────

/** Evidence types that contribute to confidence scoring. */
export type EvidenceType =
  | "symbol-resolution"
  | "static-assignment"
  | "object-assign"
  | "dotted-jsx"
  | "namespace-export"
  | "prefix-heuristic"
  | "runtime-confirmed"
  | "render-ownership"
  | "import-graph"
  | "jsx-nesting"
  | "module-ownership";

/**
 * Confidence metadata for an inferred relationship.
 */
export interface ConfidenceMeta {
  /** Confidence score from 0.0 to 1.0 */
  score: number;
  /** Evidence types that contributed to this score */
  evidence: EvidenceType[];
}

// ─── Diagnostics ───────────────────────────────────────────

/** Diagnostic severity levels. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/** Diagnostic category for structured error reporting. */
export type DiagnosticCategory =
  | "orphan-node"
  | "unresolved-jsx"
  | "unresolved-import"
  | "duplicate-canonical-id"
  | "invalid-route-ownership"
  | "runtime-static-mismatch"
  | "impossible-render-tree"
  | "circular-ownership"
  | "duplicate-composite-registration"
  | "low-confidence-composite"
  | "parse-error";

/**
 * Structured diagnostic emitted during verification passes.
 */
export interface Diagnostic {
  /** Diagnostic category */
  category: DiagnosticCategory;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Human-readable message */
  message: string;
  /** Source file where the issue was detected */
  file?: string;
  /** Node or component ID related to this diagnostic */
  nodeId?: string;
  /** Additional context */
  context?: Record<string, unknown>;
  /**
   * Human-readable suggestion describing how to resolve the diagnostic.
   * Surfaced in dashboards and CI output to give users a concrete next step.
   */
  suggestion?: string;
  /**
   * Other canonical IDs that participate in this diagnostic. For example a
   * `circular-ownership` diagnostic lists every node in the cycle, and a
   * `duplicate-composite-registration` lists every offending registration.
   */
  relatedNodes?: string[];
  /**
   * Link to documentation that explains the diagnostic category or specific
   * occurrence in more depth (e.g. a docs site or RFC anchor).
   */
  docUrl?: string;
}

// ─── Component Metadata ────────────────────────────────────

/**
 * Metadata for a single component discovered via AST analysis.
 */
export interface ComponentMeta {
  /** Canonical identity */
  identity: CanonicalIdentity;
  /** Unique identifier — canonical format: `relativePath#exportName` */
  id: string;
  /** Component display name */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Classified component type */
  type: ComponentType;
  /** Whether the component is client or server rendered */
  rendering: RenderingEnvironment;
  /** Export style: default or named */
  exportType: "default" | "named";
  /** Direct import paths this component uses */
  imports: string[];
  /** Canonical IDs of components used inside JSX of this component */
  jsxChildren: string[];
  /** Routes where this component appears */
  usedInRoutes: string[];
  /** Canonical IDs of files that import this component */
  usedInFiles: string[];
  /** Whether this component is used in more than one route or file */
  isReusable: boolean;
  /** Whether this component uses dynamic import */
  isDynamicImport: boolean;
  /** Line number of the component declaration */
  line: number;
  /** Column number of the component declaration */
  column: number;
  /** Whether this is a composite/compound component root */
  isComposite: boolean;
  /** Sub-component short names for composite APIs */
  subComponents: string[];
  /** Canonical IDs of sub-components */
  subComponentIds: string[];
  /** Confidence in the component classification */
  confidence: ConfidenceMeta;
  /**
   * True if the file or any function within it carries the `"use server"`
   * directive (i.e. the module contributes one or more server actions).
   * Optional for backward compatibility with manifests generated before C2.
   */
  hasServerActions?: boolean;
}

// ─── Route Metadata ────────────────────────────────────────

/**
 * Metadata for a detected route in Next.js App Router.
 */
export interface RouteMeta {
  /** URL path, e.g. "/users" */
  path: string;
  /** Absolute file path to the page.tsx */
  filePath: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Segment type */
  segmentType: "static" | "dynamic" | "catch-all" | "optional-catch-all" | "parallel" | "intercepting";
  /** Associated layout file path, if any */
  layoutFilePath: string | null;
  /** Associated loading file path, if any */
  loadingFilePath: string | null;
  /** Associated error file path, if any */
  errorFilePath: string | null;
  /** Associated template file path, if any */
  templateFilePath: string | null;
  /** Canonical IDs of components used in this route's page */
  components: string[];
  /** Whether the route uses route groups */
  isRouteGroup: boolean;
  /** Parent route path */
  parentRoute: string | null;
}

// ─── API Routes, Middleware, Parallel Slots, Server Actions ─

/**
 * HTTP method exported by a Next.js Route Handler (`route.ts`).
 * Mirrors the spec from https://nextjs.org/docs/app/api-reference/file-conventions/route.
 */
export type ApiRouteMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * Metadata for a Next.js Route Handler discovered via `route.{ts,tsx,js,jsx}`
 * files in the App Router. Distinct from {@link RouteMeta} (which represents
 * page routes); API routes have no UI and expose HTTP handlers instead.
 */
export interface ApiRoute {
  /** URL path, e.g. "/api/users/[id]" */
  path: string;
  /** Absolute file path to the route handler */
  filePath: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Sorted list of HTTP methods exported by the handler */
  methods: ApiRouteMethod[];
  /** Segment type (mirrors {@link RouteMeta.segmentType}) */
  segmentType: RouteMeta["segmentType"];
  /** Whether the path contains a dynamic segment */
  isDynamic: boolean;
}

/**
 * Metadata for a Next.js middleware file (`middleware.{ts,tsx,js,jsx}`) located
 * at the project root or under `src/`. A project may have at most one.
 */
export interface MiddlewareMeta {
  /** Absolute file path */
  filePath: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Whether the file has a default export (the middleware function) */
  hasDefaultExport: boolean;
  /**
   * Matcher patterns extracted from `export const config = { matcher: [...] }`.
   * `null` when the file does not export a config or the matcher is dynamic.
   */
  matcher: string[] | null;
}

/**
 * A parallel route slot (`@slot`) attached to a parent layout.
 * Slot directories are skipped in URL paths but render alongside the main
 * page through their parent layout's `props.<slotName>` argument.
 */
export interface ParallelSlot {
  /** Slot name without the `@` prefix, e.g. "modal" for `@modal` */
  name: string;
  /** URL path of the parent layout that consumes this slot */
  parentPath: string;
  /** Absolute path to the slot's `page.tsx` (or default file if present) */
  filePath: string;
  /** Relative path from project root */
  relativePath: string;
  /** Whether the slot has a `default.{tsx,ts,jsx,js}` fallback file */
  hasDefault: boolean;
}

/**
 * A server action discovered via the `"use server"` directive. Either:
 *   - `scope: "module"` — the directive is at the top of the file, so every
 *     exported async function in the module is a server action.
 *   - `scope: "function"` — the directive is the first statement inside a
 *     specific async function.
 */
export interface ServerActionMeta {
  /** Canonical id of the action: `relativePath#exportName` (or `#__module__`) */
  canonicalId: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Export name; `"__module__"` when the directive is file-level */
  exportName: string;
  /** Where the `"use server"` directive was found */
  scope: "module" | "function";
  /** 1-based line number of the directive */
  line: number;
}

/**
 * Search parameter usage metadata.
 */
export interface SearchParamUsage {
  /** The parameter name */
  param: string;
  /** Components that read this param (canonical IDs) */
  usedIn: string[];
  /** Access pattern: searchParams.x, useSearchParams(), params.x */
  accessPattern: "searchParams" | "useSearchParams" | "params";
}

/**
 * Complexity metrics for a route.
 */
export interface RouteComplexity {
  /** Maximum dependency depth */
  depth: number;
  /** Total components in dependency tree */
  components: number;
  /** Total dependencies (all types) */
  dependencies: number;
}

/**
 * Complete route intelligence for a single route.
 * ROOT ENTITY = ROUTE. Every dependency belongs to a route tree.
 */
export interface RouteIntelligence {
  /** URL path */
  path: string;
  /** File path to page.tsx */
  filePath: string;
  /** Relative file path from project root */
  relativePath: string;
  /** Segment type */
  segmentType: RouteMeta["segmentType"];
  /** Search params used in this route's dependency tree */
  searchParams: Record<string, SearchParamUsage>;
  /** Dynamic route params ([id], [slug], etc.) */
  dynamicParams: string[];
  /** All canonical component names in the dependency tree */
  components: string[];
  /**
   * Canonical component names reached only through lazy imports — i.e.
   * `next/dynamic` factories or bare `import("...")` expressions. Every entry
   * is also present in `components`. Useful for bundle-split awareness.
   */
  lazyComponents: string[];
  /**
   * Canonical component names reached through at least one eager static
   * import (the complement of `lazyComponents` within `components`). Every
   * entry is also present in `components`.
   */
  eagerComponents: string[];
  /** All hooks used in the dependency tree */
  hooks: string[];
  /** All utils used in the dependency tree */
  utils: string[];
  /** All providers in the dependency tree */
  providers: string[];
  /** All dialogs in the dependency tree */
  dialogs: string[];
  /** All grids/tables in the dependency tree */
  grids: string[];
  /** All charts in the dependency tree */
  charts: string[];
  /** Complete dependency list (all types) */
  dependencies: string[];
  /** Total dependency count */
  dependencyCount: number;
  /**
   * Project-relative paths of every source file traversed when building this
   * route's dependency tree (page + layout/template/loading/error + everything
   * reachable via imports / `next/dynamic` / `import()`). Sorted, deduplicated.
   *
   * Used by the incremental pipeline: if none of these files appear in the
   * change frontier between two runs, the previous {@link RouteIntelligence}
   * for this path can be reused without re-traversing the AST.
   *
   * Optional for backward compatibility with manifests written before this
   * field existed; consumers must treat a missing/empty value as "unknown,
   * always re-analyze".
   */
  dependencyFiles?: string[];
  /** Complexity metrics */
  complexity: RouteComplexity;
  /** Layout file path if any */
  layoutFilePath: string | null;
  /** Loading file path if any */
  loadingFilePath: string | null;
  /** Error file path if any */
  errorFilePath: string | null;
  /** Template file path if any */
  templateFilePath: string | null;
  /** Whether route uses route groups */
  isRouteGroup: boolean;
  /** Parent route path */
  parentRoute: string | null;
}

/**
 * Component usage tracking across routes.
 */
export interface ComponentUsageMap {
  [canonicalId: string]: {
    usedInRoutes: string[];
    usageCount: number;
    type: ComponentType;
    filePath: string;
  };
}

/**
 * Runtime metadata collected from mounted component tracking.
 */
export interface RuntimeMeta {
  /** Canonical component ID */
  componentId: string;
  /** Total mount count */
  mountCount: number;
  /** Total unmount count */
  unmountCount: number;
  /** Total render count */
  renderCount: number;
  /** Last mounted timestamp (ISO) */
  lastMountedAt: string | null;
  /** Last unmounted timestamp (ISO) */
  lastUnmountedAt: string | null;
  /** Routes this component has been mounted on */
  mountedOnRoutes: string[];
  /** Average render duration in ms */
  averageRenderDuration: number;
}

// ─── Separated Graphs ──────────────────────────────────────

/**
 * A node in any dependency graph.
 */
export interface GraphNode {
  /** Canonical component or route ID */
  id: string;
  /** Display label */
  label: string;
  /** Node classification */
  type: ComponentType | "route" | "file";
  /** Metadata attached to this node */
  meta?: Record<string, unknown>;
}

/**
 * An edge in any dependency graph.
 */
export interface GraphEdge {
  /** Source node ID (canonical) */
  source: string;
  /** Target node ID (canonical) */
  target: string;
  /** Relationship type */
  relationship: "imports" | "renders" | "routes-to" | "parent-child" | "reuses" | "owns" | "mounts";
  /** Confidence in this edge */
  confidence?: ConfidenceMeta;
}

/**
 * Import graph: A imports B (module-level dependency).
 */
export interface ImportGraph {
  nodes: GraphNode[];
  edges: GraphEdge[]; // relationship: "imports"
}

/**
 * Render graph: A renders B (JSX containment).
 */
export interface RenderGraph {
  nodes: GraphNode[];
  edges: GraphEdge[]; // relationship: "renders"
}

/**
 * Composite ownership graph: B belongs to A (compound component).
 */
export interface CompositeOwnershipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[]; // relationship: "owns"
}

/**
 * Runtime mount graph: B mounted under A (actual DOM hierarchy).
 */
export interface RuntimeMountGraph {
  nodes: GraphNode[];
  edges: GraphEdge[]; // relationship: "mounts"
}

/**
 * Separated graph system — each relationship type has its own graph.
 */
export interface SeparatedGraphs {
  import: ImportGraph;
  render: RenderGraph;
  compositeOwnership: CompositeOwnershipGraph;
  runtimeMount: RuntimeMountGraph;
}

/**
 * Full dependency graph (unified view for backward compatibility).
 */
export interface DependencyGraph {
  /** All graph nodes */
  nodes: GraphNode[];
  /** All graph edges */
  edges: GraphEdge[];
}

// ─── Summary + Manifest ────────────────────────────────────

/**
 * Summary counts for the project.
 */
export interface IntelligenceSummary {
  screens: number;
  components: number;
  reusableComponents: number;
  dialogs: number;
  grids: number;
  charts: number;
  providers: number;
  layouts: number;
  pages: number;
  hooks: number;
  utils: number;
  clientComponents: number;
  serverComponents: number;
  avgComplexity: number;
  maxComplexity: number;
  /** Count of Route Handlers (`route.ts`) discovered. */
  apiRoutes: number;
  /** Number of middleware files (0 or 1 in practice). */
  middlewareCount: number;
  /** Total parallel slot pages discovered across all layouts. */
  parallelSlots: number;
  /** Total server actions discovered. */
  serverActions: number;
}

/**
 * Top-level manifest output.
 */
export interface IntelligenceManifest {
  /**
   * Semver of the manifest schema (`MAJOR.MINOR.PATCH`). Bumped on any
   * change to manifest shape. Consumers should reject mismatched majors.
   * See {@link MANIFEST_SCHEMA_VERSION}.
   */
  schemaVersion: string;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** Project root path */
  projectRoot: string;
  /** Summary counts */
  summary: IntelligenceSummary;
  /** All discovered routes */
  routes: RouteMeta[];
  /** Route intelligence keyed by route path */
  routeIntelligence: Record<string, RouteIntelligence>;
  /** All discovered components keyed by canonical ID */
  components: Record<string, ComponentMeta>;
  /** Component usage map — which routes use which components */
  componentUsage: ComponentUsageMap;
  /** Unified dependency graph (backward compat) */
  graph: DependencyGraph;
  /** Separated graphs by relationship type */
  graphs: SeparatedGraphs;
  /** Runtime data keyed by canonical component ID */
  runtime: Record<string, RuntimeMeta>;
  /** Diagnostics from verification passes */
  diagnostics: Diagnostic[];
  /** Route Handlers (Next.js `route.ts`) discovered in the App Router. */
  apiRoutes: ApiRoute[];
  /** Project middleware (Next.js `middleware.ts`); empty when none is present. */
  middleware: MiddlewareMeta[];
  /** Parallel route slots (`@slot` directories) attached to their parent layout. */
  parallelSlots: ParallelSlot[];
  /** Server actions discovered via the `"use server"` directive. */
  serverActions: ServerActionMeta[];
  /**
   * Cheap, post-analysis derived metrics computed from the rest of the
   * manifest (and, optionally, merged bundle stats). Always safe to omit
   * — consumers must treat absence as "not computed".
   *
   * Added in schema 1.1.0; older manifests will not have this field.
   */
  derived?: DerivedMetrics;
}

// ─── Bundle Stats (optional merge input) ────────────────────

/**
 * Per-route bundle weight, typically derived from a framework build manifest
 * (e.g. Next.js `app-build-manifest.json` + on-disk file sizes). All sizes
 * are uncompressed bytes unless suffixed `Gzip`.
 */
export interface RouteBundleStats {
  /** URL path this stat applies to (same shape as {@link RouteMeta.path}). */
  path: string;
  /** Total JavaScript bytes for this route (uncompressed). */
  jsBytes: number;
  /** Total CSS bytes for this route (uncompressed). */
  cssBytes: number;
  /** First-load JS in bytes, when available (Next.js terminology). */
  firstLoadJs?: number;
  /** Chunk identifiers or file paths attributed to this route. */
  chunkIds: string[];
}

/**
 * Aggregate bundle stats for a project. Optional input to
 * {@link DerivedMetrics} — when supplied, per-route `bundle` will be populated.
 */
export interface BundleStats {
  /** Human-readable origin of the data (`"next/app-build-manifest.json"`, file path, etc.). */
  source: string;
  /** Sum of all route `jsBytes`. */
  totalJsBytes: number;
  /** Sum of all route `cssBytes`. */
  totalCssBytes: number;
  /** Per-route stats keyed by URL path. */
  routes: Record<string, RouteBundleStats>;
}

// ─── Derived Metrics ───────────────────────────────────────

/** Distribution of edge/composite confidence scores. */
export interface ConfidenceHistogram {
  /** Count of items with score >= 0.8 */
  high: number;
  /** Count of items with 0.5 <= score < 0.8 */
  medium: number;
  /** Count of items with score < 0.5 */
  low: number;
}

/**
 * Per-component derived metrics. Pure functions of the manifest — no extra
 * AST work is required to recompute these.
 */
export interface ComponentDerivedMetrics {
  /** Canonical component id (matches {@link ComponentMeta.id}). */
  canonicalId: string;
  /** Number of distinct files that import this component. */
  fanIn: number;
  /** Number of direct imports declared by this component's module. */
  fanOut: number;
  /** Number of distinct routes whose dependency tree contains this component. */
  routeCount: number;
  /** Number of distinct JSX children rendered by this component. */
  jsxChildCount: number;
  /**
   * 0..1 score capturing reusability. Combines route breadth and file breadth
   * with a logarithmic dampening so the top of the curve isn't dominated by
   * one ultra-shared primitive. Higher = more reusable.
   */
  reusabilityScore: number;
  /** True when the component has no inbound references (no fanIn, no routes). */
  isDead: boolean;
  /** True when runtime metrics exist for this canonical id. */
  hasRuntime: boolean;
}

/**
 * Per-route derived metrics.
 */
export interface RouteDerivedMetrics {
  /** URL path (matches {@link RouteMeta.path}). */
  path: string;
  /**
   * Normalised complexity score in 0..1 across the project: relative to the
   * route with the highest `complexity.components + complexity.dependencies`.
   */
  complexityScore: number;
  /** Fraction of `components` reached only through lazy imports, 0..1. */
  lazyRatio: number;
  /**
   * 1 - lazyRatio — higher means more of the tree ships eagerly with the
   * route. Surfaced as "bundle risk".
   */
  bundleRisk: number;
  /** Whether the route declares an `error.tsx`. */
  hasErrorBoundary: boolean;
  /** Whether the route declares a `loading.tsx`. */
  hasLoading: boolean;
  /** Whether a `not-found` file is declared (best-effort from file path). */
  hasNotFound: boolean;
  /**
   * Fraction of components in this route's dependency tree whose `rendering`
   * is `client`, 0..1. Excludes unresolved component names.
   */
  clientComponentRatio: number;
  /**
   * Composite "hotness" score, 0..1. Combines `complexityScore` with
   * normalised runtime mount counts when available, so frequently-visited
   * heavy routes float to the top.
   */
  hotness: number;
  /** Bundle stats joined on `path`, when bundle stats were supplied. */
  bundle?: RouteBundleStats;
}

/**
 * Post-analysis derived metrics block. Computed from the rest of the manifest
 * by {@link IntelligenceManifest.derived | the pipeline}; safe to recompute
 * client-side from the same inputs.
 */
export interface DerivedMetrics {
  /** Schema version of the derived block itself. Bumped independently. */
  version: string;
  /** Top-line counts for quick consumption. */
  totals: {
    components: number;
    routes: number;
    deadComponents: number;
    reusableComponents: number;
    diagnostics: number;
  };
  /** `diagnostics.length / components.length` (or 0 when no components). */
  diagnosticDensity: number;
  /** Distribution of edge confidence across the unified graph. */
  confidenceHistogram: ConfidenceHistogram;
  /** Top components by reusabilityScore, sorted desc. Capped at 20. */
  topReusable: ComponentDerivedMetrics[];
  /** Top routes by hotness, sorted desc. Capped at 20. */
  hotspotRoutes: RouteDerivedMetrics[];
  /** Canonical ids of components with no inbound references. */
  deadComponents: string[];
  /** Full per-component map keyed by canonical id. */
  components: Record<string, ComponentDerivedMetrics>;
  /** Full per-route map keyed by URL path. */
  routes: Record<string, RouteDerivedMetrics>;
  /** Bundle aggregate when bundle stats were merged. */
  bundle?: {
    source: string;
    totalJsBytes: number;
    totalCssBytes: number;
    routesWithStats: number;
  };
}

// ─── Registration + Configuration ──────────────────────────

/**
 * Registration payload used by the runtime hook.
 * Uses canonical identity for stable tracking.
 */
export interface ComponentRegistration {
  /** Canonical component ID */
  canonicalId: string;
  /** Component type classification */
  type: ComponentType;
  /** Source file path (relative) */
  sourceFile: string;
  /** Export name */
  exportName: string;
  /** Composite root canonical ID (if sub-component) */
  compositeRoot: string | null;
}

/**
 * Classification rules for component type detection.
 */
export interface ClassificationRule {
  /** Component type to assign */
  type: ComponentType;
  /** Name patterns to match (case-insensitive) */
  namePatterns: RegExp[];
  /** Import paths that indicate this type */
  importPatterns: string[];
  /** JSX tag names that indicate this type */
  jsxTagPatterns: string[];
}

/**
 * Configuration for the analyzer.
 */
export interface AnalyzerConfig {
  /** Absolute project root path */
  projectRoot: string;
  /** Glob patterns for files to include */
  include: string[];
  /** Glob patterns for files to exclude */
  exclude: string[];
  /** Primary app directory relative to project root */
  appDir: string;
  /** All detected app directories (for monorepos / nested apps) */
  appDirs?: string[];
  /** Output directory for intelligence files */
  outputDir: string;
  /** Enable incremental analysis */
  incremental: boolean;
  /** Cache directory */
  cacheDir: string;
  /** Custom classification rules (applied before defaults) */
  customRules?: ClassificationRule[];
  /** tsconfig path (auto-detected if not specified) */
  tsConfigPath?: string;
  /**
   * Optional path to a bundle-stats JSON file the pipeline should merge into
   * the derived metrics block. Accepts either:
   *   - a {@link BundleStats} document (used as-is), or
   *   - a Next.js `app-build-manifest.json` (auto-converted; file sizes are
   *     read from the `.next/` directory relative to {@link projectRoot}).
   *
   * When omitted, the pipeline still tries `.next/app-build-manifest.json`
   * relative to the project root on a best-effort basis; missing files are
   * silently skipped.
   */
  bundleStatsPath?: string;
}

// ─── Built-in Hook Exclusions ──────────────────────────────

/**
 * React built-in hooks to exclude from intelligence output.
 */
export const REACT_BUILTIN_HOOKS: ReadonlySet<string> = new Set([
  "useState",
  "useEffect",
  "useCallback",
  "useMemo",
  "useRef",
  "useReducer",
  "useContext",
  "useTransition",
  "useDeferredValue",
  "useId",
  "useLayoutEffect",
  "useImperativeHandle",
  "useDebugValue",
  "useSyncExternalStore",
  "useInsertionEffect",
]);

/**
 * Next.js built-in hooks to exclude from intelligence output.
 */
export const NEXTJS_BUILTIN_HOOKS: ReadonlySet<string> = new Set([
  "useRouter",
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
  "useReportWebVitals",
]);

/**
 * Check if a hook name is a built-in (React or Next.js).
 */
export function isBuiltinHook(name: string): boolean {
  return REACT_BUILTIN_HOOKS.has(name) || NEXTJS_BUILTIN_HOOKS.has(name);
}

// ─── Utility: Build Canonical ID ───────────────────────────

/**
 * Build a canonical ID from a relative file path and export name.
 * Format: `relativePath#exportName`
 */
export function buildCanonicalId(relativePath: string, exportName: string): string {
  return `${relativePath}#${exportName}`;
}

/**
 * Parse a canonical ID into its parts.
 */
export function parseCanonicalId(canonicalId: string): { sourceFile: string; exportName: string } {
  const hashIndex = canonicalId.lastIndexOf("#");
  if (hashIndex === -1) {
    return { sourceFile: canonicalId, exportName: "default" };
  }
  return {
    sourceFile: canonicalId.slice(0, hashIndex),
    exportName: canonicalId.slice(hashIndex + 1),
  };
}

// ─── Pipeline Telemetry ────────────────────────────────────

/**
 * Per-phase timing and counts captured during a pipeline run.
 * Surfaces structured observability so callers can replace ad-hoc console logging.
 */
export interface PhaseTelemetry {
  /** 1-based phase index (1..8) */
  phase: number;
  /** Stable phase identifier */
  name:
    | "discovery"
    | "route-detection"
    | "composite-detection"
    | "canonicalization"
    | "route-intelligence"
    | "graph-build"
    | "verification"
    | "output";
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Phase-specific counters (component count, edge count, etc.) */
  counts: Record<string, number>;
}

/**
 * Telemetry record returned alongside a manifest from a pipeline run.
 */
export interface PipelineTelemetry {
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
  /** Per-phase telemetry, in execution order */
  phases: PhaseTelemetry[];
  /** Diagnostic counts by severity */
  diagnostics: { error: number; warning: number; info: number };
  /** Files attempted to parse vs. successfully parsed */
  parse: { attempted: number; succeeded: number; failed: number };
  /**
   * Incremental-cache outcome for this run. Populated only when
   * `config.incremental` is true. Allows callers (CI, CLI) to report
   * "cache hit — skipped N files" without re-deriving the information.
   */
  incremental?: {
    /** True when the entire pipeline was short-circuited and the manifest
     *  was loaded from the previous run's `outputDir/manifest.json`. */
    cacheHit: boolean;
    /** Total files in the project's include globs. */
    totalFiles: number;
    /** Files added since the last cache snapshot. */
    addedFiles: number;
    /** Files whose content hash changed since the last snapshot. */
    changedFiles: number;
    /** Files removed since the last snapshot. */
    removedFiles: number;
    /** Files whose content hash matched the cache. */
    unchangedFiles: number;
    /**
     * Number of routes whose {@link RouteIntelligence} was reused from the
     * previously written manifest because none of their `dependencyFiles`
     * appeared in the change frontier. Zero on cold runs and on `cacheHit`
     * runs (where the whole manifest is reused, not per-route).
     */
    reusedRoutes?: number;
  };
}

// ─── Manifest Schema Validation ────────────────────────────

/**
 * Current manifest schema version. Bumped on any change to the manifest
 * shape. Major bumps are breaking; consumers that pinned the previous
 * major must migrate before reading.
 */
export const MANIFEST_SCHEMA_VERSION = "1.1.0" as const;

/**
 * Current `DerivedMetrics.version`. Bumped independently of
 * {@link MANIFEST_SCHEMA_VERSION} so derived metric shape changes don't
 * force a manifest major bump.
 */
export const DERIVED_METRICS_VERSION = "1.0.0" as const;

/**
 * Result of validating a candidate manifest object against the IntelligenceManifest schema.
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate that an unknown value conforms to the {@link IntelligenceManifest} schema.
 *
 * This is a shallow structural check (presence + type of top-level fields). It is
 * intentionally permissive about nested shapes so it can be used at trust boundaries
 * (file load, IPC, network) without coupling to internal evolutions.
 */
export function validateManifest(data: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(data)) {
    return { valid: false, errors: ["manifest must be a plain object"] };
  }

  const requireString = (key: string): void => {
    if (typeof data[key] !== "string") {
      errors.push(`manifest.${key} must be a string`);
    }
  };
  const requireObject = (key: string): void => {
    if (!isPlainObject(data[key])) {
      errors.push(`manifest.${key} must be an object`);
    }
  };
  const requireArray = (key: string): void => {
    if (!Array.isArray(data[key])) {
      errors.push(`manifest.${key} must be an array`);
    }
  };

  requireString("generatedAt");
  requireString("projectRoot");
  requireObject("summary");
  requireArray("routes");
  requireObject("routeIntelligence");
  requireObject("components");
  requireObject("componentUsage");
  requireObject("graph");
  requireObject("graphs");
  requireObject("runtime");
  requireArray("diagnostics");
  requireArray("apiRoutes");
  requireArray("middleware");
  requireArray("parallelSlots");
  requireArray("serverActions");

  // schemaVersion: validate presence, format, and major match.
  const rawSchema = data["schemaVersion"];
  if (typeof rawSchema !== "string") {
    errors.push("manifest.schemaVersion must be a string");
  } else if (!/^\d+\.\d+\.\d+$/.test(rawSchema)) {
    errors.push(`manifest.schemaVersion must be semver MAJOR.MINOR.PATCH, got "${rawSchema}"`);
  } else {
    const major = rawSchema.split(".")[0];
    const expectedMajor = MANIFEST_SCHEMA_VERSION.split(".")[0];
    if (major !== expectedMajor) {
      errors.push(
        `manifest.schemaVersion major mismatch: got ${rawSchema}, expected ${expectedMajor}.x.x (current ${MANIFEST_SCHEMA_VERSION})`
      );
    }
  }

  if (isPlainObject(data["graph"])) {
    if (!Array.isArray((data["graph"] as Record<string, unknown>)["nodes"])) {
      errors.push("manifest.graph.nodes must be an array");
    }
    if (!Array.isArray((data["graph"] as Record<string, unknown>)["edges"])) {
      errors.push("manifest.graph.edges must be an array");
    }
  }

  if (isPlainObject(data["graphs"])) {
    for (const sub of ["import", "render", "compositeOwnership", "runtimeMount"]) {
      const g = (data["graphs"] as Record<string, unknown>)[sub];
      if (!isPlainObject(g)) {
        errors.push(`manifest.graphs.${sub} must be an object`);
        continue;
      }
      if (!Array.isArray((g as Record<string, unknown>)["nodes"])) {
        errors.push(`manifest.graphs.${sub}.nodes must be an array`);
      }
      if (!Array.isArray((g as Record<string, unknown>)["edges"])) {
        errors.push(`manifest.graphs.${sub}.edges must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assertion variant of {@link validateManifest} — throws on failure.
 */
export function assertManifest(data: unknown): asserts data is IntelligenceManifest {
  const result = validateManifest(data);
  if (!result.valid) {
    throw new Error(`Invalid IntelligenceManifest:\n  - ${result.errors.join("\n  - ")}`);
  }
}
