# @i2c/intelligence — AI Context Document

> **Generated**: 2026-06-03
> **Version**: 0.1.2
> **Package**: `@i2c/intelligence`
> **Manifest Schema Version**: `1.1.0`
> **Derived Metrics Version**: `1.0.0`
> **License**: MIT
>
> This document is generated **only from source code** under `tools/`. Where the
> source does not provide evidence for a claim, the section is marked
> **"Not enough evidence found in source code."** Implementation is the source of
> truth; this supersedes any older `context.md` (the previous version documented
> `0.0.5`).

---

## 1. Project Overview

### What It Does

`@i2c/intelligence` is a **static analysis + runtime instrumentation toolkit** for
Next.js App Router applications. It parses a project's TypeScript/TSX source using
the TypeScript compiler (via `ts-morph`), reconstructs the full architecture —
routes, components, hooks, utilities, providers, server actions, API routes,
middleware, parallel slots — and emits a set of deterministic JSON artifacts
describing the application. It additionally provides build-time source
transformation, React runtime tracking hooks, and a React dashboard for
visualization.

### Core Purpose

Provide **architectural intelligence** for large Next.js codebases so that
engineering teams and AI agents can reason about:

- which components belong to which route dependency trees,
- how components are reused across routes/files,
- which dependencies are lazy (`next/dynamic` / `import()`) vs eager,
- search-param and dynamic-param usage per route,
- composite/compound component ownership,
- structural inconsistencies (orphans, cycles, duplicate IDs),
- derived quality metrics (dead code, reusability, route hotness, bundle risk).

### Primary Workflows

1. **CLI Analysis** — `intelligence` binary runs the 8-phase pipeline on demand,
   with `--watch`, `--diff`, `--stats`, `--json`, and `--fail-on-error` modes.
2. **Build-time Analysis** — `withIntelligence()` wraps `next.config` and runs the
   pipeline at config-resolution time (before the Next build), supporting both
   Webpack and Turbopack.
3. **Source Transformation** — the compiler injects `useComponentRegistration(...)`
   calls into `"use client"` components.
4. **Runtime Tracking** — React hooks (`useComponentRegistration`,
   `useRouteTracking`) plus `IntelligenceProvider` capture mount/unmount/render
   telemetry in the browser.
5. **Dashboard Visualization** — React components render route trees, dependency
   hierarchies, derived insights, a command palette, and a ReactFlow graph.

### Main Use Cases

- Understanding/onboarding into large Next.js monoliths.
- Feeding architectural context to AI coding assistants.
- CI gating via manifest diffing and `--fail-on-error`.
- Detecting dead components, low-confidence composites, and reusability hotspots.

### Target Consumers

- Engineering teams with large Next.js App Router codebases.
- AI agents / LLM tooling needing structured architecture context.
- Platform / DevEx teams building internal developer tooling.

### High-Level Architecture

```
┌────────────────────────────── Consumer Next.js App ──────────────────────────────┐
│  next.config.* ─ withIntelligence() ─► runIntelligencePipeline() (build-time)     │
│  layout ─ <IntelligenceProvider> ─ useRouteTracking() + useComponentRegistration()│
│  dev page ─ <IntelligenceDashboard /> / <RouteFlowGraph /> / <InsightsPanel />    │
└───────────────────────────────────────────────────────────────────────────────────┘
        │                         │                          │
        ▼                         ▼                          ▼
┌───────────────┐      ┌────────────────────┐       ┌────────────────┐
│  compiler     │      │   core engine      │       │   runtime      │
│ (transform +  │      │  (AnalysisSession  │       │ (provider +    │
│  next-plugin) │      │   → 8-phase pipe)  │       │  hooks)        │
└───────────────┘      └────────────────────┘       └────────────────┘
        │                         │                          │
        └─────────────────────────┼──────────────────────────┘
                                   ▼
                        ┌────────────────────┐
                        │   types module     │  (shared contracts +
                        │  + dashboard       │   manifest validation)
                        └────────────────────┘
```

---

## 2. Tech Stack

| Category | Technology | Details (from source/package.json) |
|---|---|---|
| **Language** | TypeScript `^5.6.3` | ESM, `"type": "module"` |
| **Module System** | ESM | `.js` extensions appended post-build by `scripts/fix-esm-imports.mjs` |
| **Framework Target** | Next.js `>=14.0.0` (peer) | App Router; plugin supports Webpack + Turbopack |
| **React** | `>=18.2.0` (peer), `react-dom >=18.2.0` | Hooks + Context for runtime |
| **AST Analysis** | `ts-morph ^25.0.1` | TypeScript compiler wrapper; symbol resolution |
| **File Scanning** | `fast-glob ^3.3.3` | Glob-based discovery |
| **Graph Visualization** | `@xyflow/react ^12.8.6` | ReactFlow for dashboard graphs |
| **Build** | `tsc -p tsconfig.build.json` | No bundler |
| **Post-build** | `scripts/fix-esm-imports.mjs` | Adds `.js` to relative imports |
| **Testing** | `node --test` over `tests/**/*.test.mjs` | `vitest` is also a devDependency |
| **Lint** | None configured | `echo "No lint step configured"` |
| **Registry** | Private Artifactory | `artifacts-local.i2cinc.com/repository/dd-npm-private/` |
| **Node** | `>=18.18.0` (engines) | `--watch` recursive fs.watch needs Node 20+ on Linux |

Runtime dependencies (shipped): `@xyflow/react`, `fast-glob`, `ts-morph`.

---

## 3. Folder Architecture

```
nextJs-inteligence/
├── package.json              # THE published artifact (@i2c/intelligence)
├── tsconfig.build.json       # Single build config
├── context.md                # This document
├── docs/rfcs/RFC-001-...md   # Analysis session / IR runtime architecture RFC
├── scripts/
│   ├── benchmark.mjs
│   └── fix-esm-imports.mjs   # Post-compile ESM `.js` extension fixer
├── tests/unit/*.test.mjs     # node:test suites (run against built dist)
└── tools/
    ├── intelligence-types/        # Layer 0 — shared contracts + manifest validation
    │   └── src/index.ts
    ├── intelligence-core/         # Layer 1 — static analysis engine + CLI
    │   └── src/
    │       ├── cli.ts             # `intelligence` binary
    │       ├── pipeline.ts        # 8-phase orchestrator
    │       ├── registry.ts        # Singleton manifest aggregator
    │       ├── cache.ts           # Incremental SHA-256 cache
    │       ├── config-loader.ts   # .intelligencerc / intelligence.config.*
    │       ├── derived-metrics.ts # Post-analysis metrics
    │       ├── manifest-diff.ts   # CI diffing
    │       ├── output-writer.ts   # Deterministic JSON writer
    │       ├── logger.ts          # console/silent loggers
    │       ├── analyzer/          # All AST detectors/builders (17 files)
    │       ├── session/           # AnalysisSession, SessionState, stores, adapter
    │       ├── ir/                # InMemoryIRStore (versioned IR snapshots)
    │       └── passes/            # PassManager (topological pass scheduler)
    ├── intelligence-compiler/     # Layer 2 — source transform + next-plugin
    │   └── src/{index,next-plugin,transform}.ts
    ├── intelligence-runtime/      # Layer 2 — React provider + hooks
    │   └── src/{index,provider,use-component-registration,use-route-tracking}.tsx
    └── intelligence-dashboard/    # Layer 3 — React visualization
        └── src/{index,dashboard,command-palette,insights-panel,route-flow-graph,tokens}.tsx
```

**Dependency direction (must not be violated):**

```
dashboard ─► types
runtime   ─► types
compiler  ─► core ─► types
core      ─► types
types     ─► (no internal deps)
```

`intelligence-types` is the bottom layer and depends on nothing internal. `core`
depends on `types`. `compiler` depends on `core` (for `classifyComponent` and
`runIntelligencePipeline`) and `runtime` (the injected import target). `runtime`
and `dashboard` depend only on `types`.

---

## 4. Public API Surface

Exports map (from `package.json`):

| Subpath | Source entry | Purpose |
|---|---|---|
| `.` / `./core` | `intelligence-core/src/index.ts` | Pipeline, registry, session, analyzer facade |
| `./core/analyzer` | `intelligence-core/src/analyzer/index.ts` | Individual detectors/builders |
| `./compiler` | `intelligence-compiler/src/index.ts` | Source transforms |
| `./compiler/next-plugin` | `intelligence-compiler/src/next-plugin.ts` | `withIntelligence()` |
| `./runtime` | `intelligence-runtime/src/index.ts` | Provider + hooks |
| `./dashboard` | `intelligence-dashboard/src/index.ts` | React UI |
| `./types` | `intelligence-types/src/index.ts` | Shared contracts |

`bin`: `intelligence` → `dist/tools/intelligence-core/src/cli.js`.

### 4.1 `./core` exports (`intelligence-core/src/index.ts`)

- `IntelligenceRegistry` — singleton manifest aggregator (class).
- `runIntelligencePipeline(userConfig?, options?)` → `Promise<IntelligenceManifest>`.
- `runIntelligencePipelineDetailed(userConfig?, options?)` → `Promise<PipelineRunResult>`.
- `runIntelligencePipelineInternal(config, registry, diagnosticsStore?, logger?)` →
  `Promise<PipelineRunResult>` (used by `AnalysisSession`).
- Types: `PipelineRunOptions`, `PipelineRunResult`.
- `consoleLogger`, `silentLogger`, type `Logger`.
- `loadConfigFile(projectRoot)`, `mergeConfigs(loaded, user)`, type `ConfigLoadResult`.
- `OutputWriter` (class).
- `IncrementalCache` (class).
- `diffManifests(prev, curr)`, `formatManifestDiff(diff)`, type `ManifestDiff`.
- `deriveMetrics(manifest, bundleStats?)`, `loadBundleStats(projectRoot, path?)`.
- Re-exports from `./analyzer/index` (see 4.2).
- Session/IR/passes: `AnalysisSession`, `SessionState`, `PassManager`,
  `PassScheduleError`, types `AnalysisPass`, `PassExecutionRecord`,
  `InMemoryDiagnosticsStore`, `InMemoryIRStore`, `RegistryAdapter`.

**Usage example:**

```ts
import { runIntelligencePipelineDetailed } from "@i2c/intelligence/core";

const { manifest, telemetry } = await runIntelligencePipelineDetailed(
  { projectRoot: process.cwd(), outputDir: ".generated/intelligence" }
);
console.log(manifest.summary, telemetry.totalDurationMs);
```

### 4.2 `./core/analyzer` exports (`analyzer/index.ts`)

- `ComponentAnalyzer` (class), type `ParseFailure`.
- `detectRoutes(projectRoot, appDirs)`.
- `detectApiRoutes(projectRoot, appDirs)`, `detectMiddleware(projectRoot)`.
- `detectParallelSlots(projectRoot, appDirs)`.
- `ServerActionDetector` (class).
- `classifyComponent(...)`, `containsProviderPattern(src)`,
  `DEFAULT_CLASSIFICATION_RULES`.
- `GraphBuilder` (class).
- `RecursiveTraverser`, `InMemoryTraversalCache`; types `TraversalCache`,
  `ResolvedDependency`, `TraversalResult`.
- `SearchParamsAnalyzer` (class).
- `RouteIntelligenceBuilder` (class).
- `CompositeDetector` (class).
- `SymbolResolver` (class).
- `Canonicalizer` (class).
- `VerificationPass` (class).
- `BuildOutputAnalyzer` (class); types `BuildOutputAnalysis`,
  `BuildOutputRouteInfo`, `BuildOutputServerAction`, `BuildOutputClientBoundary`,
  `BuildOutputMiddleware`.

> Note: `BuildOutputAnalyzer` is exported from the analyzer barrel but is **not
> invoked by the main pipeline** (`pipeline.ts`). It is an available building
> block for `.next/` build-output analysis, consumed on demand.

### 4.3 `./compiler` exports

- `transformSource(source, filePath, projectRoot)` →
  `{ code, transformed, componentsInjected }`.
- `transformFile(filePath, projectRoot)` → `Promise<TransformResult>`.
- `transformProject(options)` → `Promise<TransformResult[]>`.
- `withIntelligence(nextConfig?, pluginOptions?)` → `Promise<NextConfig>` (also at
  `./compiler/next-plugin`).

**Usage example (`next.config.mjs`):**

```js
import { withIntelligence } from "@i2c/intelligence/compiler/next-plugin";
export default await withIntelligence({ /* nextConfig */ }, { appDir: "app" });
```

### 4.4 `./runtime` exports

- `IntelligenceProvider` (`React.FC<{ children, debug? }>`).
- `useIntelligenceContext()` → context value.
- `useComponentRegistration(meta: ComponentRegistration)` → `void`.
- `useRouteTracking()` → `void`.

**Usage example (root layout):**

```tsx
import { IntelligenceProvider, useRouteTracking } from "@i2c/intelligence/runtime";

function RouteSync() { useRouteTracking(); return null; }
export default function Layout({ children }) {
  return <IntelligenceProvider><RouteSync />{children}</IntelligenceProvider>;
}
```

### 4.5 `./dashboard` exports

- Components: `IntelligenceDashboard`, `SummaryGrid`, `SummaryCard`, `RouteTree`,
  `RouteIntelligencePanel`, `DependencyHierarchy`, `ComponentUsageTable`,
  `RuntimeTree`, `RouteFlowGraph`, `CommandPalette`, `InsightsPanel`.
- Hook: `useManifestData(options)`.
- Tokens: `lightTokens`, `darkTokens`, `useTheme()`.
- Types: `PaletteResult`, `InsightsPanelProps`.

### 4.6 `./types` exports (`intelligence-types/src/index.ts`)

Type contracts (interfaces/types): `ComponentType`, `RenderingEnvironment`,
`CanonicalIdentity`, `EvidenceType`, `ConfidenceMeta`, `DiagnosticSeverity`,
`DiagnosticCategory`, `Diagnostic`, `ComponentMeta`, `RouteMeta`,
`ApiRouteMethod`, `ApiRoute`, `MiddlewareMeta`, `ParallelSlot`,
`ServerActionMeta`, `SearchParamUsage`, `RouteComplexity`, `RouteIntelligence`,
`ComponentUsageMap`, `RuntimeMeta`, `GraphNode`, `GraphEdge`, `ImportGraph`,
`RenderGraph`, `CompositeOwnershipGraph`, `RuntimeMountGraph`, `SeparatedGraphs`,
`DependencyGraph`, `IntelligenceSummary`, `IntelligenceManifest`,
`RouteBundleStats`, `BundleStats`, `ConfidenceHistogram`,
`ComponentDerivedMetrics`, `RouteDerivedMetrics`, `DerivedMetrics`,
`ComponentRegistration`, `ClassificationRule`, `AnalyzerConfig`,
`PhaseTelemetry`, `PipelineTelemetry`, `ManifestValidationResult`.

Runtime values / functions:

- `REACT_BUILTIN_HOOKS`, `NEXTJS_BUILTIN_HOOKS` (`ReadonlySet<string>`).
- `isBuiltinHook(name)` → `boolean`.
- `buildCanonicalId(relativePath, exportName)` → `string`.
- `parseCanonicalId(id)` → `{ sourceFile, exportName }`.
- `MANIFEST_SCHEMA_VERSION = "1.1.0"`, `DERIVED_METRICS_VERSION = "1.0.0"`.
- `validateManifest(data)` → `ManifestValidationResult`.
- `assertManifest(data)` → asserts `IntelligenceManifest` (throws on failure).

---

## 5. Internal Module Architecture

For each major module: responsibility, public API, internal dependencies, and
consumers.

### 5.1 `pipeline.ts`

- **Responsibility**: orchestrate the 8-phase analysis; manage incremental
  cache, partial route reuse, telemetry, manifest export and writing.
- **Public API**: `runIntelligencePipeline`, `runIntelligencePipelineDetailed`,
  `runIntelligencePipelineInternal`, `DEFAULT_CONFIG` (internal).
- **Depends on**: app-dir-resolver, ComponentAnalyzer, route/api/slot detectors,
  ServerActionDetector, CompositeDetector, Canonicalizer,
  RouteIntelligenceBuilder, GraphBuilder, VerificationPass, OutputWriter,
  IncrementalCache, config-loader, derived-metrics, AnalysisSession, registry.
- **Consumers**: `cli.ts`, `next-plugin.ts`, `AnalysisSession`, tests.

### 5.2 `registry.ts` — `IntelligenceRegistry`

- **Responsibility**: singleton that aggregates components, routes, route
  intelligence, component usage, runtime data, and graph edges, then exports an
  `IntelligenceManifest`.
- **Public API** (selected): `getInstance()`, `resetInstance()`,
  `setProjectRoot()`, `registerComponent(s)`, `registerRoute(s)`,
  `registerRouteIntelligence`, `registerComponentUsage`, `mountComponent`,
  `unmountComponent`, `recordRender`, `getRuntimeData`, `mergeRuntimeData`,
  `addEdge(s)`, `exportGraph()`, `exportManifest()`, `clear()`.
- **Internal logic**: edges deduped by `${source}|${target}|${relationship}`;
  runtime merge sums counts and unions routes; `computeSummary()` derives type
  counts and avg/max complexity. Summary fields `apiRoutes`, `middlewareCount`,
  `parallelSlots`, `serverActions` are initialized to 0 and **patched by the
  pipeline** after Phase 2 detection.
- **Consumers**: pipeline, AnalysisSession, runtime registry merging.

### 5.3 `session/` (RFC-001 runtime)

- `AnalysisSession` — orchestrator wrapping `runIntelligencePipelineInternal`.
  Holds `state`, `registry`, `diagnosticsStore`, `irStore`, `passManager`,
  `logger`. Methods `run()`, `runDetailed()`, `dispose()`. Drives lifecycle
  transitions `initialized → ir-built → passes-executed → verified → emitted`.
- `SessionState` — strict lifecycle FSM. States: `created`, `initialized`,
  `ir-built`, `passes-executed`, `verified`, `emitted`, `failed`, `disposed`.
  `transitionTo()` throws on invalid transitions; `failed`/`disposed` reachable
  from any state.
- `InMemoryDiagnosticsStore` (implements `DiagnosticsStore`): `add`, `addMany`,
  `getAll`, `clear`.
- `RegistryAdapter.resolve(registry?)` — returns injected registry or singleton.

### 5.4 `ir/ir-store.ts` — `InMemoryIRStore`

- Versioned IR snapshots. `IRKind = "ast" | "semantic" | "graph" | "manifest"`.
  `SnapshotId` format `${kind}:${6-digit-counter}` (e.g. `ast:000001`).
- API: `beginWrite<T>(kind, passId)` → `IRWriteHandle<T>` (`set`, `commit`),
  `getSnapshot<T>(id)`, `getLatestSnapshotId(kind)`, `clear()`.

### 5.5 `passes/pass-manager.ts` — `PassManager`

- Deterministic pass scheduler. `AnalysisPass { id, stage, dependsOn?, run() }`
  with `stage ∈ {build-ir, analyze, verify, emit-prep}`.
- Kahn topological sort with stage-index + id tie-breaking for byte-identical
  ordering. Cycle/unknown-dependency detection throws `PassScheduleError`
  (optionally carrying the cycle).
- `PassExecutionRecord` includes `deterministicOrderKey` = SHA-256 of
  `${stage}:${id}`. API: `register`, `plan()`, `runAll()`, `getLedger()`.

### 5.6 Support modules

- `cache.ts` — `IncrementalCache`: SHA-256 content hashing; persists
  `${cacheDir}/intelligence-cache.json` (`{ version: 1, entries }`).
- `config-loader.ts` — loads `.intelligencerc.json`, `.intelligencerc`,
  `intelligence.config.mjs`, `intelligence.config.js` (first match wins).
- `derived-metrics.ts` — `deriveMetrics`, `loadBundleStats`.
- `manifest-diff.ts` — `diffManifests`, `formatManifestDiff`.
- `output-writer.ts` — `OutputWriter` (deterministic, key-sorted JSON).
- `logger.ts` — `consoleLogger` (`[intelligence]` prefix), `silentLogger`.

---

## 6. Analysis Pipeline

The pipeline is implemented in `runIntelligencePipelineInternal` (`pipeline.ts`).
Eight phases run sequentially. Telemetry is recorded per phase
(`PhaseTelemetry`), aggregated into `PipelineTelemetry`.

```
Phase 1  Discovery            ComponentAnalyzer.analyze() + SymbolResolver
   ▼  (components, importEdges, renderEdges, ts-morph project, parse failures)
Phase 2  Route Detection      detectRoutes / detectApiRoutes / detectMiddleware /
   ▼                          detectParallelSlots + ServerActionDetector
Phase 3  Composite Detection  CompositeDetector.detect() + applyToComponents()
   ▼
Phase 4  Canonicalization     Canonicalizer.canonicalize()
   ▼
Phase 5  Route Intelligence   RouteIntelligenceBuilder.build() (recursive traversal)
   ▼
Phase 6  Graph Construction   GraphBuilder.buildSeparated() + build()
   ▼
Phase 7  Verification         VerificationPass.verify() → Diagnostic[]
   ▼
Phase 8  Export + Write       registry.exportManifest() → deriveMetrics →
                              OutputWriter.writeAll() + cache.save()
```

### Phase details

| Phase | Input | Processing | Output | Main classes/functions |
|---|---|---|---|---|
| 1 Discovery | config include globs | Parse files with ts-morph; extract components, imports, JSX render edges; symbol resolution | `components`, `importEdges`, `renderEdges`, `project`, `parseFailures` | `ComponentAnalyzer`, `SymbolResolver`, `classifyComponent` |
| 2 Route detection | projectRoot, appDirs | Glob `page.*`, `route.*`, `middleware.*`, `@slot/page.*`; detect server actions from project | `routes`, `apiRoutes`, `middleware`, `parallelSlots`, `serverActions` | `detectRoutes`, `detectApiRoutes`, `detectMiddleware`, `detectParallelSlots`, `ServerActionDetector` |
| 3 Composite | project, components | Semantic-first (static-assign / Object.assign / dotted JSX / module co-location) then prefix heuristic | `Map<string, CompositeGroup>` | `CompositeDetector` |
| 4 Canonicalization | components, composites | Normalize identities, collapse sub-components to root, build lookup maps | `CanonicalizationResult` | `Canonicalizer` |
| 5 Route intelligence | project, routes, canonical components, composites | Recursive DFS traversal per route (page+layout+template+loading+error roots); search/dynamic params; complexity; eager/lazy split; optional cache reuse | `routeIntelligence`, `componentUsage`, `updatedComponents` | `RouteIntelligenceBuilder`, `RecursiveTraverser`, `SearchParamsAnalyzer` |
| 6 Graph build | components, routes, edges, composites | Build separated graphs (import/render/ownership/runtimeMount) + unified | `SeparatedGraphs`, `DependencyGraph` | `GraphBuilder` |
| 7 Verification | components, routes, graphs, composites | Structural passes (orphans, cycles, duplicates, unresolved JSX, confidence) | `Diagnostic[]` | `VerificationPass` |
| 8 Output | manifest + derived | Export manifest, derive metrics, merge bundle stats, write JSON, persist cache | files on disk + `PipelineRunResult` | `IntelligenceRegistry.exportManifest`, `deriveMetrics`, `OutputWriter` |

### Incremental short-circuit & partial reuse

When `incremental: true` (`pipeline.ts`):

1. `IncrementalCache.classifyChanges(snapshot)` returns `added/changed/removed/
   unchanged`.
2. **Full cache hit** — if nothing changed and a prior manifest validates, the
   pipeline returns the cached manifest and skips all phases
   (`incremental.cacheHit = true`).
3. **Partial reuse** — otherwise, a prior manifest's `routeIntelligence` entries
   whose `dependencyFiles` do not intersect the change frontier
   (`added ∪ changed ∪ removed`, project-relative POSIX) are passed to Phase 5 as
   `reusableRoutes`, skipping recursive AST traversal for those routes.

---

## 7. Route Intelligence System

`RouteIntelligenceBuilder` (`route-intelligence-builder.ts`) produces a
`RouteIntelligence` record per route path. Each record (see
`intelligence-types`) includes:

- `path`, `filePath`, `relativePath`, `segmentType`.
- `searchParams: Record<string, SearchParamUsage>`, `dynamicParams: string[]`.
- Component buckets: `components`, `lazyComponents`, `eagerComponents`, `hooks`,
  `utils`, `providers`, `dialogs`, `grids`, `charts`, `dependencies`,
  `dependencyCount`.
- `dependencyFiles?` — every traversed source file (page + layout/template/
  loading/error + everything reachable via imports / `next/dynamic` / `import()`),
  sorted and deduplicated. Drives incremental partial reuse.
- `complexity: { depth, components, dependencies }`.
- Special files: `layoutFilePath`, `loadingFilePath`, `errorFilePath`,
  `templateFilePath`; plus `isRouteGroup`, `parentRoute`.

**Traversal**: `RecursiveTraverser` does iterative DFS over the ts-morph project,
visiting each file once. It classifies each `ResolvedDependency` by `kind`
(`component | hook | util | provider | type | unknown`) and marks `isLazy: true`
for components reached **only** through `next/dynamic` or bare `import()` (never
via an eager import). `InMemoryTraversalCache` memoizes per-file analysis,
collapsing repeated work across routes; cache `{ hits, misses }` are reported in
telemetry.

**Search/dynamic params**: `SearchParamsAnalyzer.analyzeFiles()` handles function
parameter destructuring, renamed/nested destructuring, `useSearchParams()` /
`useParams()` variable bindings, bracket access, and `.get/.getAll/.has()`.
`SearchParamsAnalyzer.extractParamsFromRoutePath()` extracts `[param]` segments.

**Route detection** (`route-detector.ts`): globs `**/page.{tsx,ts,jsx,js}`,
associates adjacent `layout/loading/error/template` files, strips route groups
`(name)` and parallel slots `@slot` from URL paths, and types segments
(`static | dynamic | catch-all | optional-catch-all | parallel | intercepting`).

**API routes & middleware** (`api-route-detector.ts`): regex-based extraction of
exported HTTP methods from `route.*`, and `config.matcher` from `middleware.*`.

**Parallel slots** (`parallel-slot-detector.ts`): globs `**/@*/**/page.*`,
resolves parent path, and detects a `default.*` fallback (`hasDefault`).

---

## 8. Component Intelligence System

### Discovery (`component-analyzer.ts`)

`ComponentAnalyzer` parses files with ts-morph, walks function/arrow/variable
declarations matching PascalCase, and produces `ComponentMeta` for each component
with canonical identity. It builds **import edges** using ts-morph module
resolution (honoring aliases / `baseUrl` / path mappings) and **render edges**
from JSX usage (confidence `0.95`, evidence `["symbol-resolution", "jsx-nesting"]`).
A component is `isReusable` when imported by 2+ files. Parse failures are surfaced
as `ParseFailure[]` and emitted as `parse-error` diagnostics.

### Classification (`classifier.ts`)

`classifyComponent(name, imports, jsxTags, filePath, customRules?, sourceText?)`
assigns a `ComponentType` using, in priority order: name patterns → import
patterns → JSX tag patterns → AST provider detection (`createContext` /
`.Provider`) → file convention (`page`/`layout`/etc.) → fallback `component`.
`DEFAULT_CLASSIFICATION_RULES` cover `provider`, `dialog`, `grid`, `chart`
(e.g. dialog imports `@radix-ui`/`@headlessui`; grid imports
`@tanstack/react-table`/`ag-grid`/`@mui/x-data-grid`; chart imports
`recharts`/`echarts`/`d3`/`victory`/`@nivo`/`chart.js`). `customRules` are applied
before defaults. `containsProviderPattern(src)` and `PROVIDER_AST_PATTERNS` back
the provider heuristic.

### Composite detection (`composite-detector.ts`)

`CompositeDetector.detect(project, components)` returns
`Map<string, CompositeGroup>`. **Semantic signals** (strong): static property
assignment (`DataGrid.Header = ...`), `Object.assign(Root, {...})`, dotted JSX
(`<DataGrid.Header/>`), module co-location. **Prefix heuristic** (fallback,
unclaimed components only) requires ≥2 sub-components. **Confidence**: `0.95` for
2+ evidence types, `0.9` for a single semantic signal, `0.6` for the prefix
heuristic. `applyToComponents()` annotates `ComponentMeta` and returns the set of
sub-component full names.

### Server actions (`server-action-detector.ts`)

`ServerActionDetector.detect()` finds `"use server"` directives. **Module scope**:
file-level directive marks all exported async functions
(`exportName = "__module__"`). **Function scope**: directive inside a specific
async function. Components whose files contain actions get `hasServerActions = true`.

---

## 9. Graph Architecture

The system maintains a **separated graph model** plus a unified view. Nodes are
`GraphNode { id, label, type, meta? }`; edges are
`GraphEdge { source, target, relationship, confidence? }` where `relationship ∈
{imports, renders, routes-to, parent-child, reuses, owns, mounts}`.

`SeparatedGraphs` (`GraphBuilder.buildSeparated()`):

| Graph | Edge relationship | Meaning | Built from |
|---|---|---|---|
| `import` (`ImportGraph`) | `imports` | A imports B (module-level dependency) | `addImportEdges` (ts-morph resolution) |
| `render` (`RenderGraph`) | `renders` | A renders B (JSX containment) | `addRenderEdges` (JSX) |
| `compositeOwnership` (`CompositeOwnershipGraph`) | `owns` | B belongs to compound root A | `addCompositeOwnership` |
| `runtimeMount` (`RuntimeMountGraph`) | `mounts` | B mounted under A (actual DOM) | runtime data (empty at static time) |

Additional edges fold into the **unified** `DependencyGraph` (`build()`): route
edges (`routes-to`, `parent-child` from `addRoutes`) and reuse edges (`reuses`
from `addReusabilityEdges`). The unified graph is stored under
`manifest.graph`; the separated graphs under `manifest.graphs`. Edges are deduped
by `${source}|${target}|${relationship}`.

**Why separate**: keeping `imports`, `renders`, and `owns` distinct prevents graph
contamination — e.g. a component can be imported but never rendered, or own a
sub-component it never directly imports. Consumers (dashboard `RouteFlowGraph`,
verification cycle detection) select the relationship semantics they need.

---

## 10. Runtime Tracking System

Implemented in `intelligence-runtime/src`.

### `IntelligenceProvider` (`provider.tsx`)

React context provider. Holds runtime telemetry in a
`useRef<Map<string, RuntimeMeta>>` (in-memory, per provider instance). Context
value (`IntelligenceContextValue`):

- `mount(registration, route)` — increments `mountCount`, unions
  `mountedOnRoutes`, sets `lastMountedAt`.
- `unmount(componentId)` — increments `unmountCount`, sets `lastUnmountedAt`.
- `recordRender(componentId, durationMs)` — updates rolling
  `averageRenderDuration`.
- `getRuntimeData()`, `exportRuntimeData()` (serializable
  `Record<string, RuntimeMeta>`).
- `getCurrentRoute()`, `setCurrentRoute(route)`.
- `debug?` prop enables console logging. `useIntelligenceContext()` throws if used
  outside the provider.

### Hooks

- `useComponentRegistration(meta)` (`use-component-registration.tsx`) — injected by
  the compiler into client component bodies. Times render via
  `performance.now()`, calls `mount()` once (guarded by a ref), records render
  duration, and returns a cleanup that calls `unmount()`.
- `useRouteTracking()` (`use-route-tracking.tsx`) — placed in the root layout.
  Reads `window.location.pathname`, listens to `popstate`, and uses a
  `MutationObserver` on `document.head` to catch Next.js client-side navigation
  (URL changes without `popstate`); calls `setCurrentRoute()` on changes.

### Lifecycle

```
render ─► useComponentRegistration: capture renderStart
   ▼
effect(mount once) ─► provider.mount(registration, currentRoute)
   ▼
every render ─► provider.recordRender(id, performance.now() - renderStart)
   ▼
unmount ─► cleanup ─► provider.unmount(id)
```

Runtime data populates `RuntimeMeta` and, when merged into a registry
(`mergeRuntimeData`), the `runtimeMount` graph and `manifest.runtime`. Telemetry
is collected in-memory; **no network/persistence transport is implemented** — it
is exposed via `exportRuntimeData()` for the consumer to ship. There is no browser
auto-export beyond this API. **Not enough evidence found in source code** for any
built-in telemetry backend.

---

## 11. Compiler Integration

Implemented in `intelligence-compiler/src`.

### `withIntelligence(nextConfig?, pluginOptions?)` (`next-plugin.ts`)

Next.js 14+ plugin. `IntelligencePluginOptions`:

| Option | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Toggle pipeline run |
| `appDir` | `"app"` | App directory override |
| `outputDir` | `".generated/intelligence"` | Manifest output |
| `incremental` | `true` | Incremental cache |
| `include` | (defaults) | Custom globs |
| `exclude` | (defaults) | Custom exclusions |

At config-resolution time it calls `runIntelligencePipeline(...)` (async) before
the build starts, supports both Webpack and Turbopack, and spreads the existing
`nextConfig` unchanged. Pipeline failures are caught and logged via
`console.error`.

### Source transform (`transform.ts`)

`transformSource`, `transformFile`, `transformProject` perform **regex-based**
source-to-source transformation:

1. Skip files already marked with `/* __INTELLIGENCE_INJECTED__ */`.
2. Skip server components (only transform files with a top `"use client"`
   directive).
3. Match exported component declarations (`export function`,
   `export default function`, `export const X = () => {}`, function expressions,
   and `forwardRef`/`memo` wrappers).
4. Inject, after the `"use client"` directive:
   ```ts
   import { useComponentRegistration } from "@i2c/intelligence/runtime";
   /* __INTELLIGENCE_INJECTED__ */
   ```
5. Inject at the start of each matched component body:
   ```ts
   useComponentRegistration({
     canonicalId: "path/file.tsx#ComponentName",
     type: "component",            // inferred via classifyComponent()
     sourceFile: "path/file.tsx",
     exportName: "ComponentName",
     compositeRoot: null,
   });
   ```

Component type is inferred via `classifyComponent()` from core. Canonical IDs use
`${relativePath}#${componentName}` with forward-slash normalization. A dry-run
mode is supported (read-only); writes are deferred until all transforms complete.

> The transform is **regex-driven**, not AST-driven — this is a deliberate
> simplicity/perf trade-off and a known fragility surface (see Technical Debt).

---

## 12. Manifest Structure

`IntelligenceManifest` (`intelligence-types`) is the central output:

```jsonc
{
  "schemaVersion": "1.1.0",
  "generatedAt": "2026-06-03T12:00:00.000Z",
  "projectRoot": "/abs/project",
  "summary": {
    "screens": 0, "components": 0, "reusableComponents": 0,
    "dialogs": 0, "grids": 0, "charts": 0, "providers": 0,
    "layouts": 0, "pages": 0, "hooks": 0, "utils": 0,
    "clientComponents": 0, "serverComponents": 0,
    "avgComplexity": 0, "maxComplexity": 0,
    "apiRoutes": 0, "middlewareCount": 0,
    "parallelSlots": 0, "serverActions": 0
  },
  "routes": [ /* RouteMeta[] */ ],
  "routeIntelligence": { "/users": { /* RouteIntelligence */ } },
  "components": { "components/button.tsx#Button": { /* ComponentMeta */ } },
  "componentUsage": { "components/button.tsx#Button": { "usedInRoutes": ["/"], "usageCount": 1, "type": "component", "filePath": "..." } },
  "graph": { "nodes": [], "edges": [] },
  "graphs": {
    "import": { "nodes": [], "edges": [] },
    "render": { "nodes": [], "edges": [] },
    "compositeOwnership": { "nodes": [], "edges": [] },
    "runtimeMount": { "nodes": [], "edges": [] }
  },
  "runtime": { /* Record<canonicalId, RuntimeMeta> */ },
  "diagnostics": [ /* Diagnostic[] */ ],
  "apiRoutes": [ /* ApiRoute[] */ ],
  "middleware": [ /* MiddlewareMeta[] */ ],
  "parallelSlots": [ /* ParallelSlot[] */ ],
  "serverActions": [ /* ServerActionMeta[] */ ],
  "derived": { /* DerivedMetrics, schemaVersion 1.1.0+ */ }
}
```

### `ComponentMeta` (selected fields)

`identity` (`CanonicalIdentity`), `id`, `name`, `filePath`, `relativePath`,
`type`, `rendering` (`client|server`), `exportType` (`default|named`), `imports`,
`jsxChildren`, `usedInRoutes`, `usedInFiles`, `isReusable`, `isDynamicImport`,
`line`, `column`, `isComposite`, `subComponents`, `subComponentIds`, `confidence`,
`hasServerActions?`.

### Validation

`validateManifest(data)` is a shallow structural check (top-level field presence +
types) plus `schemaVersion` semver/major matching against
`MANIFEST_SCHEMA_VERSION` (`1.1.0`). Consumers must reject a mismatched major.
`assertManifest()` throws on failure. The pipeline calls `validateManifest` when
loading a cached manifest for reuse.

---

## 13. Output Files

`OutputWriter.writeAll()` writes deterministic, key-sorted JSON (recursive key
sort, trailing newline) into `outputDir` (default `.generated/intelligence`):

| File | Contents | Source type |
|---|---|---|
| `manifest.json` | Complete manifest | `IntelligenceManifest` |
| `graph.json` | Unified graph | `DependencyGraph` |
| `graphs/import.json` | Import graph | `ImportGraph` |
| `graphs/render.json` | Render graph | `RenderGraph` |
| `graphs/composite-ownership.json` | Ownership graph | `CompositeOwnershipGraph` |
| `graphs/runtime-mount.json` | Runtime mount graph | `RuntimeMountGraph` |
| `routes.json` | Route intelligence map | `Record<string, RouteIntelligence>` |
| `runtime.json` | Runtime metrics | `Record<string, RuntimeMeta>` |
| `diagnostics.json` | Diagnostics | `Diagnostic[]` |
| `derived.json` | Derived metrics (when present) | `DerivedMetrics` |

Cache artifact: `${cacheDir}/intelligence-cache.json`
(`{ version: 1, entries: { [path]: { hash, timestamp } } }`), default `cacheDir`
`node_modules/.cache/intelligence`.

---

## 14. Configuration

### `AnalyzerConfig` (consumer-facing)

| Field | Type | Default | Required |
|---|---|---|---|
| `projectRoot` | `string` | `process.cwd()` | resolved automatically |
| `include` | `string[]` | app/components/ui globs (auto from app dirs) | optional |
| `exclude` | `string[]` | `**/*.test.*`, `**/*.spec.*`, `**/*.stories.*`, `**/__tests__/**` | optional |
| `appDir` | `string` | auto-detected (`resolveAppDirectories`) | optional |
| `appDirs?` | `string[]` | all detected app dirs | optional |
| `outputDir` | `string` | `.generated/intelligence` | optional |
| `incremental` | `boolean` | `true` | optional |
| `cacheDir` | `string` | `node_modules/.cache/intelligence` | optional |
| `customRules?` | `ClassificationRule[]` | — | optional (applied before defaults) |
| `tsConfigPath?` | `string` | auto-detected | optional |
| `bundleStatsPath?` | `string` | best-effort `.next/app-build-manifest.json` | optional |

`DEFAULT_CONFIG` (pipeline.ts): `include = ["app/**/*.{tsx,ts}",
"components/**/*.{tsx,ts}", "@ui/**/*.{tsx,ts}", "ui/**/*.{tsx,ts}"]`,
`exclude` as above.

### Config file loading (`config-loader.ts`)

Probed in order (first match wins): `.intelligencerc.json`, `.intelligencerc`,
`intelligence.config.mjs`, `intelligence.config.js`. JSON files are strictly
parsed; `.mjs`/`.js` are imported via `file://` URL (default or named `config`
export, must be a plain object). On merge, **array fields are replaced, not
concatenated**; CLI/programmatic `userConfig` always wins over file values.

### `ClassificationRule`

`{ type: ComponentType, namePatterns: RegExp[], importPatterns: string[],
jsxTagPatterns: string[] }`.

---

## 15. CLI Reference

Binary: `intelligence` (`cli.ts`). Flags:

| Flag | Argument | Default | Behavior |
|---|---|---|---|
| `--root` | `<path>` | cwd | Project root |
| `--output` | `<dir>` | `.generated/intelligence` | Output directory |
| `--app-dir` | `<dir>` | auto-detect | Override app directory |
| `--no-cache` | — | cache on | Disable incremental cache |
| `--watch` | — | off | Re-run on file changes (recursive `fs.watch`) |
| `--watch-debounce` | `<ms>` | `150` | Coalesce change bursts |
| `--quiet` | — | off | Suppress phase logs |
| `--stats` | — | off | Print per-phase telemetry |
| `--diff` | — | off | Print delta vs previous manifest |
| `--json` | — | off | Machine-readable JSON to stdout (implies `--quiet`) |
| `--fail-on-error` | — | off | Exit `1` if any error diagnostics |
| `--help`, `-h` | — | — | Show help |

Notes: `--json` is incompatible with `--watch` (exits `2`). In watch mode the loop
runs until SIGINT/SIGTERM; rebuilds are debounced and serialized (edits during a
rebuild re-trigger once). `--diff` snapshots the prior `manifest.json` before the
run and prints added/removed/changed routes & components plus diagnostic deltas.

**Examples:**

```bash
intelligence --root . --stats
intelligence --watch --watch-debounce 200
intelligence --json --diff > report.json
intelligence --fail-on-error
```

---

## 16. Dependency Mapping

```
intelligence-types  ──────────────►  (none internal)
intelligence-core   ──────────────►  intelligence-types
  analyzer/*        ──────────────►  intelligence-types
  session/*         ──────────────►  pipeline, registry, ir, passes
  pipeline.ts       ──────────────►  analyzer/*, registry, cache, config-loader,
                                     derived-metrics, output-writer, session
intelligence-compiler ────────────►  intelligence-core (classifyComponent,
                                     runIntelligencePipeline), runtime (injected
                                     import target), intelligence-types
intelligence-runtime  ────────────►  intelligence-types
intelligence-dashboard ───────────►  intelligence-types, @xyflow/react
```

External runtime deps: `ts-morph` (analyzer), `fast-glob` (detectors/analyzer),
`@xyflow/react` (dashboard). Peers: `next`, `react`, `react-dom`.

**Forbidden directions**: `types` must not import from any other internal module;
`runtime`/`dashboard` must not import from `core`/`compiler`; `core` must not
import from `compiler`/`runtime`/`dashboard`.

---

## 17. Performance Optimizations

- **Incremental cache** (`IncrementalCache`): SHA-256 content hashing classifies
  files into added/changed/removed/unchanged; a clean run with a valid prior
  manifest skips all 8 phases.
- **Partial route reuse**: routes whose `dependencyFiles` are untouched by the
  change frontier reuse prior `RouteIntelligence`, skipping Phase 5 AST traversal.
- **Traversal cache** (`InMemoryTraversalCache`): memoizes per-file dependency
  analysis, collapsing `O(routes × transitive-imports)` toward
  `O(transitive-imports)`. Hit/miss stats reported in telemetry.
- **Symbol resolution cache** (`SymbolResolver`): per-file/per-name memoization of
  JSX/import resolution.
- **Single ts-morph project**: built once in Phase 1 and reused by composite,
  server-action, route-intelligence, and traversal stages.
- **Deterministic, parallel output writes**: `OutputWriter` writes files via
  `Promise.all` with recursive key sorting for stable diffs.
- **Watch debounce**: coalesces editor save bursts into a single rebuild.

---

## 18. Error Handling

- **Parse failures**: `ComponentAnalyzer` collects `ParseFailure[]`; the pipeline
  converts them to `parse-error` warning diagnostics with actionable suggestions
  and continues (skips the file).
- **Bundle stats**: best-effort. A missing `.next/app-build-manifest.json` is
  silently skipped; an explicit unreadable `bundleStatsPath` logs a warning (not
  fatal in the catch path).
- **Cached manifest reuse**: guarded by `validateManifest`; invalid/missing
  manifests fall back to a full run.
- **CLI**: one-shot mode logs the error stack and `process.exit(1)`; watch mode
  catches rebuild failures and keeps watching. `--fail-on-error` exits `1` on
  error diagnostics; `--json + --watch` exits `2`.
- **Session FSM**: `SessionState.transitionTo()` throws on illegal transitions;
  `PassManager` throws `PassScheduleError` on cycles/unknown dependencies.
- **Runtime**: `useIntelligenceContext()` throws when used outside the provider.

---

## 19. Diagnostics & Verification

`VerificationPass.verify()` runs after graph construction and returns
`Diagnostic[]`. Categories (`DiagnosticCategory`) and severities:

| Category | Severity | Meaning |
|---|---|---|
| `orphan-node` | info | Component unreachable from any route (BFS reachability) |
| `unresolved-jsx` | warning | JSX tag maps to no known component |
| `unresolved-import` | (warning) | Import target not resolved |
| `duplicate-canonical-id` | error | Two components share a canonical ID |
| `invalid-route-ownership` | warning | Route points to a non-existent page file |
| `runtime-static-mismatch` | warning | Runtime data without a matching static component |
| `impossible-render-tree` | warning | Render cycle (component renders itself) |
| `circular-ownership` | error | Composite ownership cycle (DFS in-stack) |
| `duplicate-composite-registration` | error | Sub-component claimed by multiple roots |
| `low-confidence-composite` | warning/info | Composite confidence below threshold |
| `parse-error` | warning | File failed to parse (emitted in Phase 1) |

Confidence thresholds: `WARN_THRESHOLD = 0.7` (prefix-heuristic only),
`INFO_THRESHOLD = 0.85` (single semantic signal). Diagnostics carry
`message`, optional `file`, `nodeId`, `relatedNodes`, `context`, `suggestion`,
`docUrl`.

Diagnostics flow into `manifest.diagnostics`, `diagnostics.json`, telemetry
counts, the dashboard, and `--fail-on-error`.

---

## 20. AI Guidance

### What the package currently does

- Statically analyzes Next.js App Router projects via ts-morph and emits a
  validated `IntelligenceManifest` plus separated graphs, route intelligence,
  diagnostics, and derived metrics.
- Detects routes, API routes, middleware, parallel slots, server actions,
  components, composites, hooks, utils, providers, search/dynamic params.
- Transforms `"use client"` components to self-register at runtime, and collects
  mount/render telemetry in the browser.
- Renders a dashboard (route tree, dependency hierarchy, insights, command
  palette, ReactFlow graph).

### What it generates

The output files in §13 — `manifest.json`, `graph.json`, `graphs/*.json`,
`routes.json`, `runtime.json`, `diagnostics.json`, `derived.json` — all
deterministic and key-sorted.

### What it tracks (runtime)

Per component: `mountCount`, `unmountCount`, `renderCount`, `lastMountedAt`,
`lastUnmountedAt`, `mountedOnRoutes`, `averageRenderDuration`.

### What it analyzes / exposes

See §4 (public API) and §12 (manifest). Canonical identity (`relativePath#export`)
is the universal key across all subsystems.

### How AI should consume outputs

1. Read `manifest.json`; verify `schemaVersion` major equals `1`.
2. Use `routeIntelligence[path]` for per-route dependency trees and params.
3. Use `components[canonicalId]` for component facts; `componentUsage` for reuse.
4. Use `graphs.*` for relationship-specific reasoning (don't conflate
   `imports`/`renders`/`owns`).
5. Use `derived` for hotspots, dead code, reusability, and confidence
   distribution.
6. Treat missing optional fields (`derived`, `dependencyFiles`, `hasServerActions`)
   as "unknown".

### Critical abstractions

- **Canonical identity** (`buildCanonicalId` / `parseCanonicalId`,
  `CanonicalIdentity`) — single source of truth for component identity.
- **Separated graph model** — semantic separation of relationships.
- **`AnalysisSession` + `SessionState` FSM** — lifecycle ordering.
- **`PassManager`** — deterministic scheduling (SHA-256 order keys).

### Invariants

- Canonical ID format is `relativePath#exportName` (POSIX slashes).
- Manifest output is deterministic (key-sorted) — preserve this.
- `MANIFEST_SCHEMA_VERSION` must bump on any manifest shape change; major bumps
  are breaking.
- Phase ordering 1→8 is fixed; later phases depend on earlier outputs.
- Summary `apiRoutes`/`middlewareCount`/`parallelSlots`/`serverActions` are
  patched by the pipeline (the registry cannot know them).

### Dangerous files

- `pipeline.ts` — central orchestrator; changing phase order/contract breaks
  everything downstream.
- `registry.ts` — singleton; `exportManifest()` shape is the public contract.
- `intelligence-types/src/index.ts` — every consumer depends on it; changes here
  ripple project-wide and may require a schema bump.
- `transform.ts` — regex-based code injection into user source; mistakes corrupt
  user files.
- `output-writer.ts` — determinism guarantees; breaking key-sort destabilizes
  diffs.

---

## 21. Extension Points

Safe places to extend without violating invariants:

- **Classification**: add `ClassificationRule[]` via `AnalyzerConfig.customRules`
  (applied before defaults) — no code change required.
- **Detectors**: add new analyzer modules under `analyzer/` and wire them into a
  pipeline phase; export through `analyzer/index.ts`.
- **Passes**: register new `AnalysisPass` implementations with `PassManager`
  (declare `stage` + `dependsOn`).
- **Diagnostics**: add a `DiagnosticCategory` in types and emit from
  `VerificationPass`.
- **Derived metrics**: extend `deriveMetrics` (bump `DERIVED_METRICS_VERSION`).
- **Outputs**: add `OutputWriter` methods (keep deterministic key-sorting).
- **Dashboard**: add components consuming the manifest/derived contracts.
- **Config files**: `.intelligencerc*` / `intelligence.config.*` for project-level
  configuration.

When adding manifest fields: make them optional for backward compatibility or bump
`MANIFEST_SCHEMA_VERSION` (major for breaking).

---

## 22. Breaking Changes Since Previous Version

The previous root `context.md` documented **v0.0.5**; there is no committed
CHANGELOG in the analyzed source. A precise file-by-file diff against 0.0.5 is not
reconstructable from the current tree, so this section reports what the **current
0.1.2 implementation** contains that the 0.0.5 document did not describe. Items not
verifiable against the old code are marked accordingly.

**Present in 0.1.2 (new or materially expanded vs the 0.0.5 doc):**

- **Manifest schema `1.1.0`** with `MANIFEST_SCHEMA_VERSION` / `assertManifest` /
  `validateManifest` major-version gating.
- **Derived metrics** subsystem (`derived-metrics.ts`, `DerivedMetrics`,
  `derived.json`, `loadBundleStats`, `bundleStatsPath`) — version `1.0.0`.
- **Session/IR/passes runtime** (`AnalysisSession`, `SessionState`,
  `InMemoryIRStore`, `PassManager`, `RegistryAdapter`, `InMemoryDiagnosticsStore`)
  per RFC-001.
- **Incremental partial route reuse** via `RouteIntelligence.dependencyFiles`.
- **Telemetry** (`PhaseTelemetry`, `PipelineTelemetry`) + CLI `--stats`/`--json`.
- **Manifest diffing** (`diffManifests`, `formatManifestDiff`) + CLI `--diff`.
- **Watch mode** (`--watch`, `--watch-debounce`).
- **API routes, middleware, parallel slots, server actions** detection with
  manifest collections and summary counts.
- **Separated graphs** (`import`/`render`/`compositeOwnership`/`runtimeMount`)
  alongside the unified graph.
- **`BuildOutputAnalyzer`** for `.next/` build-output analysis (exported,
  pipeline-optional).
- **Config-file loading** (`.intelligencerc*`, `intelligence.config.*`).
- **Dashboard** expansions: `CommandPalette`, `InsightsPanel`, `RouteFlowGraph`
  modes, theme tokens.

**Build behavior**: ESM with post-build `.js` extension fixing; testing via
`node --test` over `tests/**/*.test.mjs`.

> Whether each of the above is strictly *new* in 0.1.2 vs an earlier 0.1.x cannot
> be determined from the current tree — **not enough evidence found in source
> code** for an exact per-version breakdown.

---

## 23. Technical Debt

Findings supported by source/structure:

- **Regex-based source transform** (`transform.ts`): brittle vs AST transforms;
  unusual component declaration styles (HOCs, nested exports, decorators) may be
  missed or mis-injected. Highest correctness risk because it writes user files.
- **Registry summary patching**: `apiRoutes`, `middlewareCount`, `parallelSlots`,
  `serverActions` are set to 0 by the registry and mutated by the pipeline after
  export — a coupling that requires the pipeline to remember to patch them.
- **Sequential pass execution**: `PassManager` notes RFC-001 §9.1 worker-pool
  parallelization as future work; current execution is sequential.
- **`BuildOutputAnalyzer` not wired**: exported and capable, but the main pipeline
  does not invoke it; bundle stats currently come from `loadBundleStats`.
- **Runtime mount graph empty at static time**: `runtimeMount` graph is populated
  only when runtime data is merged; static manifests carry empty mount edges.
- **No runtime telemetry transport**: runtime hooks collect in-memory data only;
  shipping/persisting it is left entirely to the consumer.
- **Singleton registry**: `IntelligenceRegistry.getInstance()` global state can
  complicate concurrent/multi-project runs in one process (mitigated by
  `RegistryAdapter` injection and `resetInstance()`).
- **No lint step** configured (`echo "No lint step configured"`).
- **No explicit `TODO`/`FIXME` markers** were found in the analyzed source.

---

## 24. Smart Summary

`@i2c/intelligence` v0.1.2 is a layered Next.js intelligence toolkit:
`types` (contracts + manifest validation) → `core` (the 8-phase, ts-morph-based
analysis engine with an `AnalysisSession`/`PassManager`/IR runtime, incremental
caching, derived metrics, diffing, and a feature-rich CLI) → `compiler`
(regex source transform + `withIntelligence` Next plugin) → `runtime` (React
provider + lifecycle hooks) → `dashboard` (ReactFlow visualization, insights,
command palette).

The system's spine is **canonical identity** (`relativePath#exportName`) and a
**separated graph model** that keeps `imports`, `renders`, `owns`, and `mounts`
semantically distinct. It emits a deterministic, schema-versioned
`IntelligenceManifest` (`1.1.0`) plus separated graphs, route intelligence,
diagnostics, and derived metrics — all key-sorted for stable diffs.

For an AI agent extending the package: respect the layer dependency direction,
preserve output determinism, keep canonical identity stable, treat
`intelligence-types` and `pipeline.ts` as high-blast-radius surfaces, extend via
`customRules`, new analyzer modules, `AnalysisPass` registration, new diagnostic
categories, or derived metrics — and bump the appropriate schema version whenever
the manifest or derived-metrics shape changes.

---

# AI Development Rules

**Architectural invariants (never break):**

1. Canonical ID format is `relativePath#exportName`, POSIX slashes, produced via
   `buildCanonicalId`. Never invent ad-hoc identity schemes.
2. Manifest output must remain deterministic (recursive key-sort, trailing
   newline). Never write unsorted JSON.
3. `MANIFEST_SCHEMA_VERSION` must bump on any manifest shape change
   (`DERIVED_METRICS_VERSION` for derived shape). Major bumps are breaking.
4. Pipeline phase order (1→8) is fixed; later phases consume earlier outputs.
5. Keep the four graph relationships (`imports`/`renders`/`owns`/`mounts`)
   separate — never merge their semantics.
6. `intelligence-types` must not import any other internal module.

**Things AI must never change without explicit approval:**

- The exports map / subpath contracts in `package.json`.
- The `IntelligenceManifest` field contract without a schema bump.
- The `useComponentRegistration` injection format in `transform.ts`.
- Determinism guarantees in `output-writer.ts`.

**Safe extension points:** see §21 (custom rules, new analyzers, new passes, new
diagnostics, new derived metrics, new outputs, dashboard components).

**Existing abstractions to reuse:** `buildCanonicalId`/`parseCanonicalId`,
`GraphBuilder`, `RecursiveTraverser` + `InMemoryTraversalCache`, `SymbolResolver`,
`Canonicalizer`, `VerificationPass`, `IncrementalCache`, `OutputWriter`,
`PassManager`, `Logger`.

**Dependency rules:** `types ← core ← compiler`; `runtime`/`dashboard ← types`
only. Never introduce `core → compiler/runtime/dashboard` edges.

**Naming conventions (inferred):** PascalCase classes/components/types;
`detectX`/`buildX`/`resolveX` function verbs; canonical `relativePath#export` IDs;
`kebab-case.ts` filenames; barrel `index.ts` per module.

**Coding standards (inferred):** strict TypeScript ESM with explicit return types
on public APIs; pure/deterministic functions where possible; safe degradation on
missing/partial data (collect-and-continue rather than throw); diagnostics over
exceptions for analysis-level issues; thorough JSDoc on exported contracts.

---

# What's New In v0.1.2

The current tree contains no CHANGELOG and the previous `context.md` targeted
**0.0.5**, so an exact version-delta cannot be fully reconstructed from source.
The following capabilities are **present in the 0.1.2 implementation** (see §22 for
the caveat about exact introduction version):

- Schema-versioned manifest (`1.1.0`) with `validateManifest`/`assertManifest`.
- Derived metrics (`derived.json`, reusability, hotness, dead code, confidence
  histogram, bundle-risk) and optional bundle-stats merge.
- RFC-001 session runtime: `AnalysisSession`, `SessionState` FSM,
  `InMemoryIRStore`, `PassManager` with deterministic ordering.
- Incremental cache with full short-circuit and per-route partial reuse.
- Telemetry + CLI `--stats`, `--json`, `--diff`, `--watch`/`--watch-debounce`,
  `--fail-on-error`.
- API routes, middleware, parallel slots, and server-action detection.
- Separated graph system + unified graph.
- Config file loading (`.intelligencerc*` / `intelligence.config.*`).
- Expanded dashboard: command palette, insights panel, multi-mode ReactFlow graph,
  theme tokens.

**Breaking changes**: cannot be enumerated against 0.0.5 from the available source
— **not enough evidence found in source code**. Consumers should rely on
`MANIFEST_SCHEMA_VERSION` major (`1`) for compatibility gating.
