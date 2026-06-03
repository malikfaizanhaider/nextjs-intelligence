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
  | "duplicate-composite-registration";

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
}

/**
 * Top-level manifest output.
 */
export interface IntelligenceManifest {
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
