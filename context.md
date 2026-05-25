# @i2c/intelligence — AI Context Document

> **Generated**: 2026-05-22  
> **Version**: 0.0.5  
> **Package**: `@i2c/intelligence`  
> **License**: MIT (Faizan Haider)

---

## 1. Project Overview

### What It Does

`@i2c/intelligence` is a **static analysis + runtime instrumentation toolkit** for Next.js applications. It scans a Next.js project's source code, extracts a complete dependency graph of routes, components, hooks, and utilities, then outputs a structured JSON manifest describing the entire application architecture.

### Core Business Purpose

Provides **architectural intelligence** for large Next.js codebases — enabling teams and AI agents to understand which components live on which routes, how deeply nested the dependency trees are, which components are reused across routes, and what search/dynamic params each route consumes.

### Main Workflows

1. **Build-time Analysis** — Integrates into `next.config.ts` via `withIntelligence()` plugin. Runs an 8-phase pipeline before the Next.js build starts.
2. **CLI Analysis** — Standalone `intelligence` CLI binary for on-demand scanning without a build.
3. **Runtime Tracking** — React hooks (`useComponentRegistration`, `useRouteTracking`) capture mount/unmount/render telemetry in the browser.
4. **Source Transformation** — Compiler module injects `useComponentRegistration` calls into `"use client"` components automatically.
5. **Dashboard Visualization** — React components that render route flow graphs and summary dashboards from the manifest.

### Target Users

- Engineering teams with large Next.js monoliths
- AI coding assistants that need architectural context
- Platform/DevEx teams building internal developer tooling

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Consumer Next.js App                  │
│                                                          │
│  next.config.ts ──► withIntelligence() ──► Pipeline      │
│                                                          │
│  Layout ──► <IntelligenceProvider>                        │
│               ├─ useRouteTracking()                      │
│               └─ useComponentRegistration() (auto-injected)│
│                                                          │
│  Dev page ──► <IntelligenceDashboard />                   │
│               └─ <RouteFlowGraph />                      │
└──────────────────────────────────────────────────────────┘
         │                    │                 │
         ▼                    ▼                 ▼
┌─────────────┐    ┌──────────────────┐   ┌───────────┐
│  Compiler   │    │    Core Engine    │   │  Runtime   │
│  (transform │    │  (8-phase pipe)  │   │  (hooks +  │
│   + plugin) │    │                  │   │  provider) │
└─────────────┘    └──────────────────┘   └───────────┘
         │                    │                 │
         └────────────────────┼─────────────────┘
                              ▼
                    ┌──────────────────┐
                    │   Types Module   │
                    │ (shared contracts)│
                    └──────────────────┘
```

---

## 2. Tech Stack

| Category | Technology | Details |
|---|---|---|
| **Language** | TypeScript 5.6+ | Strict mode, ES2022 target |
| **Module System** | ESM (`"type": "module"`) | `.js` extensions added post-build via script |
| **Framework Target** | Next.js 14+ | App Router, supports Turbopack |
| **React** | React 18.2+ | Hooks API, Context for runtime |
| **AST Analysis** | ts-morph 25.x | TypeScript compiler wrapper for symbol resolution |
| **File Scanning** | fast-glob 3.x | Glob-based file discovery |
| **Graph Visualization** | @xyflow/react 12.x | ReactFlow for route/dependency graphs |
| **Build** | `tsc` (TypeScript compiler) | Single `tsconfig.build.json`, no bundler |
| **Post-build** | Custom `fix-esm-imports.mjs` | Adds `.js` extensions to relative imports |
| **Package Manager** | npm | No lockfile committed, no monorepo tooling |
| **Registry** | Private Artifactory | `artifacts-local.i2cinc.com/repository/dd-npm-private/` |
| **Testing** | None configured | `echo "No tests configured"` |
| **Linting** | None configured | `echo "No lint step configured"` |
| **CI/CD** | Not enough evidence found | No pipeline config files detected |
| **Database** | None | Pure analysis tool, outputs JSON files |
| **Auth** | None | No authentication layer |

---

## 3. Folder Architecture

```
nextJs-inteligence/
├── package.json              # Root package — THE published artifact
├── tsconfig.build.json       # Single build config for all modules
├── scripts/
│   └── fix-esm-imports.mjs   # Post-compile ESM fix
├── tools/                    # All source modules live here
│   ├── intelligence-types/   # Layer 0: Shared type contracts
│   ├── intelligence-core/    # Layer 1: Static analysis engine
│   ├── intelligence-compiler/# Layer 2: Build integration + transforms
│   ├── intelligence-runtime/ # Layer 2: Browser-side hooks
│   └── intelligence-dashboard/# Layer 3: Visualization components
└── dist/                     # Build output (gitignored)
```

### Module Details

| Module | Responsibility | Layer |
|---|---|---|
| `intelligence-types` | All shared TypeScript interfaces, type unions, utility functions (`buildCanonicalId`, `isBuiltinHook`). Zero runtime dependencies. | 0 (foundation) |
| `intelligence-core` | 8-phase analysis pipeline, AST component extraction, route detection, composite detection, canonicalization, graph construction, verification, CLI, caching, output writing. | 1 (engine) |
| `intelligence-compiler` | Next.js plugin (`withIntelligence`), source code transformation (injects `useComponentRegistration` into client components). | 2 (integration) |
| `intelligence-runtime` | React Context provider, `useComponentRegistration`, `useRouteTracking` hooks for browser telemetry. | 2 (integration) |
| `intelligence-dashboard` | `IntelligenceDashboard` component, `RouteFlowGraph` (ReactFlow), route tree, summary grids, component usage tables. | 3 (presentation) |

### Dependency Direction (STRICT)

```
types ◄── core ◄── compiler
  ▲         ▲
  │         │
  └── runtime
  ▲
  │
  └── dashboard
```

**Rules**:
- `types` depends on nothing internal
- `core` depends only on `types`
- `compiler` depends on `core` and `types`
- `runtime` depends on `types` only
- `dashboard` depends on `types` only
- NO circular dependencies exist

### Important Conventions

- All internal cross-module imports use **relative paths** (`../../intelligence-types/src/index`)
- Each module has its own `package.json` (marked `"private": true`) — these are NOT published individually
- Only the **root** `package.json` is published as `@i2c/intelligence`
- Sub-module exports are exposed via the root `"exports"` field map

---

## 4. Application Architecture

### Rendering Strategy

The toolkit **analyzes** Next.js rendering strategies but does not itself implement SSR/SSG. Key detection:
- Files with `"use client"` → `RenderingEnvironment: "client"`
- Files without → `RenderingEnvironment: "server"`
- The runtime hooks are client-only (`"use client"` directive)

### Data Flow

```
Source Files (.tsx/.ts)
    │
    ▼ (Phase 1: ComponentAnalyzer + SymbolResolver)
ComponentMeta[]
    │
    ▼ (Phase 2: detectRoutes)
RouteMeta[]
    │
    ▼ (Phase 3: CompositeDetector)
CompositeGroup Map
    │
    ▼ (Phase 4: Canonicalizer)
Canonicalized ComponentMeta[]
    │
    ▼ (Phase 5: RouteIntelligenceBuilder + RecursiveTraverser)
RouteIntelligence{}
    │
    ▼ (Phase 6: GraphBuilder)
SeparatedGraphs { import, render, compositeOwnership, runtimeMount }
    │
    ▼ (Phase 7: VerificationPass)
Diagnostic[]
    │
    ▼ (Phase 8: OutputWriter)
.generated/intelligence/
    ├── manifest.json
    ├── graph.json
    ├── routes.json
    ├── runtime.json
    ├── diagnostics.json
    └── graphs/
        ├── import.json
        ├── render.json
        ├── composite-ownership.json
        └── runtime-mount.json
```

### State Management

- **Build-time**: `IntelligenceRegistry` singleton aggregates all analysis data
- **Runtime**: React Context (`IntelligenceContext`) with `useRef` for mutable state (avoids re-renders)
- **Dashboard**: Local `useState` + `useMemo` for UI state; data loaded via fetch or prop

### Caching Strategy

- `IncrementalCache` class stores SHA-256 file content hashes in `node_modules/.cache/intelligence/intelligence-cache.json`
- Files that haven't changed are skipped on subsequent runs
- Cache is opt-in via `incremental: true` (default)

### Error Handling

- Pipeline errors are caught and logged but do NOT fail the Next.js build (`catch` in `withIntelligence`)
- Verification errors are structured `Diagnostic` objects with severity levels (error/warning/info)
- No global error boundaries or retry logic

### Routing Structure (Analysis Target)

The toolkit understands Next.js App Router conventions:
- `page.tsx` → route entry point
- `layout.tsx`, `loading.tsx`, `error.tsx`, `template.tsx` → special files
- Route groups `(groupName)` → skipped in URL path
- Parallel routes `@slot` → skipped in URL path
- Dynamic segments `[param]`, `[...slug]`, `[[...slug]]`
- Intercepting routes `(.)`, `(..)`, `(...)`

---

## 5. Coding Patterns

### Canonical Identity System

The **most critical pattern** in the codebase. Every component is identified by:

```
{relativePath}#{exportName}
```

Example: `app/components/data-grid/index.tsx#DataGrid`

This is enforced by `buildCanonicalId()` in `intelligence-types` and the `CanonicalIdentity` interface. All downstream systems (graphs, route intelligence, runtime tracking) use this format.

### Classification Rules

Components are classified via a priority chain:
1. Custom rules (user-provided `ClassificationRule[]`)
2. Default rules (`DEFAULT_CLASSIFICATION_RULES` — name patterns, import patterns, JSX tag patterns)
3. AST-based provider detection (`createContext` in source body)
4. File-convention fallback (`page.tsx` → "page", `layout.tsx` → "layout", etc.)
5. Default: `"component"`

### Composite Component Detection

Detects compound/compound component APIs (e.g., `DataGrid.Header`) via:
1. **Semantic signals** (high confidence): `Object.assign()`, static property assignments, dotted JSX, module co-location
2. **Prefix heuristics** (fallback): `DataGridTable` → root `DataGrid` + sub `Table`

### Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Classes | PascalCase | `ComponentAnalyzer`, `GraphBuilder` |
| Interfaces/Types | PascalCase | `ComponentMeta`, `RouteIntelligence` |
| Functions | camelCase | `detectRoutes`, `classifyComponent` |
| Files | kebab-case | `component-analyzer.ts`, `route-detector.ts` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_CLASSIFICATION_RULES`, `INJECTION_MARKER` |
| Canonical IDs | `path#Name` | `app/page.tsx#HomePage` |

### File Organization Pattern

Each analyzer file follows a consistent structure:
1. Imports (node builtins → ts-morph → types → sibling modules)
2. Type definitions (interfaces, exported types)
3. Main class/function export
4. Private helper methods

### Component Composition Style

- Dashboard uses **inline styles** (no CSS framework)
- ReactFlow custom nodes (`RouteNode`, `CompactNode`) with `Handle` components
- Lazy loading via `React.lazy()` for `RouteFlowGraph`

### Hook Patterns

- `useManifestData()` — data fetching hook with AbortController cleanup
- `useComponentRegistration()` — effect-based mount/unmount tracking with `useRef` for render timing
- `useRouteTracking()` — effect + MutationObserver for SPA navigation detection

---

## 6. Important Core Systems

### 6.1 Analysis Pipeline (`pipeline.ts`)

**Purpose**: Orchestrates the complete static analysis in 8 sequential phases.

**Lifecycle**:
```
configure → clear registry → load cache → Phase 1-8 → write output → save cache
```

**Phase Detail**:

| Phase | Class/Function | Input | Output |
|---|---|---|---|
| 1 | `ComponentAnalyzer` | Source files | `ComponentMeta[]`, import/render edges |
| 2 | `detectRoutes` | App directory | `RouteMeta[]` |
| 3 | `CompositeDetector.detect` | Project + components | `Map<string, CompositeGroup>` |
| 4 | `Canonicalizer.canonicalize` | Components + composites | `CanonicalizationResult` |
| 5 | `RouteIntelligenceBuilder.build` | Routes + components | `RouteIntelligence{}`, `ComponentUsageMap` |
| 6 | `GraphBuilder` | Components + routes + edges | `SeparatedGraphs`, `DependencyGraph` |
| 7 | `VerificationPass.verify` | All data | `Diagnostic[]` |
| 8 | `OutputWriter.writeAll` | Manifest | JSON files on disk |

**Extension Points**: `AnalyzerConfig.customRules` for custom classification.

### 6.2 Symbol Resolution Engine (`symbol-resolver.ts`)

**Purpose**: Resolves JSX tags and imports to canonical identities using ts-morph's type checker.

**Strategies** (in priority order):
1. TypeScript type checker symbol lookup at node position
2. Import declaration tracing (follows re-exports, barrel files, aliases)
3. Local declaration resolution

**Handles**: Direct imports, default imports, aliased imports, barrel exports, re-exports, namespace imports, path aliases (via tsconfig), dotted JSX.

**Caching**: In-memory `Map<string, ResolvedSymbol>` keyed by `filePath:name`.

### 6.3 Recursive Traverser (`recursive-traverser.ts`)

**Purpose**: Walks the entire import tree from root files using iterative DFS.

**Internal Flow**:
1. Start from page/layout/template root files
2. For each file: extract dependencies via ts-morph module resolution
3. Classify each export (`component`, `hook`, `util`, `provider`, `type`, `unknown`)
4. Track visited files to prevent cycles
5. Record max depth, all discovered hooks/utils/providers/components

**Does NOT hardcode path aliases** — relies on ts-morph's compiler-aware resolution.

### 6.4 Graph System (`graph-builder.ts`)

**Purpose**: Builds 4 semantically distinct dependency graphs.

| Graph | Relationship | Meaning |
|---|---|---|
| Import | `imports` | Module-level `import` statement |
| Render | `renders` | JSX containment (`<Child />` inside parent) |
| Composite Ownership | `owns` | Compound component relationship |
| Runtime Mount | `mounts` | Actual DOM hierarchy (from runtime data) |

**Design principle**: These relationships are **semantically different and MUST NOT be conflated**. A unified graph is also produced for backward compatibility.

### 6.5 Verification System (`verification.ts`)

**Purpose**: Structural validation after graph construction.

**Checks**:
- Orphan nodes (unreachable from any route)
- Unresolved JSX tags
- Duplicate canonical IDs
- Invalid route ownership
- Circular ownership in composites
- Duplicate composite registration
- Render cycles
- Runtime/static mismatches

### 6.6 Registry (`registry.ts`)

**Purpose**: Singleton aggregator for build-time and runtime data.

**Pattern**: Classic singleton (`getInstance()` / `resetInstance()`).

**Responsibilities**: Store components, routes, route intelligence, component usage, runtime data, graph nodes/edges. Export complete `IntelligenceManifest`.

---

## 7. Dependency Mapping

### External Dependencies

| Dependency | Used By | Purpose |
|---|---|---|
| `ts-morph` | core | AST parsing, TypeScript symbol resolution, type checker |
| `fast-glob` | core, compiler | File discovery via glob patterns |
| `@xyflow/react` | dashboard | Graph visualization (ReactFlow) |

### Peer Dependencies

| Peer | Minimum Version |
|---|---|
| `next` | >=14.0.0 |
| `react` | >=18.2.0 |
| `react-dom` | >=18.2.0 |

### Internal Module Relationships

```
intelligence-types (0 deps)
    ▲
    │ imports types + buildCanonicalId + isBuiltinHook
    │
intelligence-core
    │ imports types
    │ uses ts-morph, fast-glob
    ▲
    │ imports runIntelligencePipeline, classifyComponent
    │
intelligence-compiler
    │ imports core/pipeline, core/analyzer/classifier
    │ imports types
    │ uses fast-glob
    │
intelligence-runtime
    │ imports types only
    │
intelligence-dashboard
    │ imports types only
    │ uses @xyflow/react
```

### Circular Dependency Risks

**None detected.** The dependency direction is strictly layered.

### Tight Coupling Areas

- `compiler/transform.ts` directly imports `classifyComponent` from `core/analyzer/classifier.ts` via relative path
- `compiler/next-plugin.ts` directly imports `runIntelligencePipeline` from `core/pipeline.ts` via relative path
- All cross-module imports use deep relative paths (`../../intelligence-core/src/...`) — these would break if folder structure changes

---

## 8. Environment & Configuration

### Config Files

| File | Purpose |
|---|---|
| `tsconfig.build.json` | Build configuration — ES2022, ESNext modules, bundler resolution, JSX react-jsx |
| `package.json` (root) | Published package config with exports map |
| `package.json` (per module) | Module-local metadata (all `"private": true`) |

### TypeScript Configuration

```jsonc
{
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "react-jsx",
  "strict": true,
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true,
  "isolatedModules": true,
  "verbatimModuleSyntax": false,  // Important: allows `import type` flexibility
  "outDir": "dist",
  "rootDir": "."
}
```

**Include**: `tools/*/src/**/*.ts`, `tools/*/src/**/*.tsx`

### Runtime Configuration

The pipeline accepts `AnalyzerConfig` with these defaults:

| Option | Default |
|---|---|
| `appDir` | `"app"` |
| `outputDir` | `".generated/intelligence"` |
| `incremental` | `true` |
| `cacheDir` | `"node_modules/.cache/intelligence"` |
| `include` | `["app/**/*.{tsx,ts}", "components/**/*.{tsx,ts}", "@ui/**/*.{tsx,ts}", "ui/**/*.{tsx,ts}"]` |
| `exclude` | `["**/*.test.*", "**/*.spec.*", "**/*.stories.*", "**/__tests__/**"]` |

### Environment Variables

Not enough evidence found — no `.env` files or `process.env` references beyond `process.cwd()`.

### Feature Flags

- `IntelligencePluginOptions.enabled` — disable the plugin entirely
- `IntelligencePluginOptions.incremental` — toggle incremental caching
- `IntelligenceProvider.debug` — enable console logging of runtime events

---

## 9. API Documentation

### Exports Map (Public API)

| Import Path | Resolved Module | Key Exports |
|---|---|---|
| `@i2c/intelligence` | core/index | `IntelligenceRegistry`, `runIntelligencePipeline`, `OutputWriter`, `IncrementalCache`, all analyzer exports |
| `@i2c/intelligence/core` | core/index | Same as above |
| `@i2c/intelligence/core/analyzer` | core/analyzer/index | `ComponentAnalyzer`, `detectRoutes`, `classifyComponent`, `GraphBuilder`, `RecursiveTraverser`, `SearchParamsAnalyzer`, `RouteIntelligenceBuilder`, `CompositeDetector`, `SymbolResolver`, `Canonicalizer`, `VerificationPass` |
| `@i2c/intelligence/compiler` | compiler/index | `transformSource`, `transformFile`, `transformProject`, `withIntelligence` |
| `@i2c/intelligence/compiler/next-plugin` | compiler/next-plugin | `withIntelligence` |
| `@i2c/intelligence/runtime` | runtime/index | `IntelligenceProvider`, `useIntelligenceContext`, `useComponentRegistration`, `useRouteTracking` |
| `@i2c/intelligence/dashboard` | dashboard/index | `IntelligenceDashboard`, `RouteFlowGraph`, `SummaryGrid`, `SummaryCard`, `RouteTree`, `RouteIntelligencePanel`, `DependencyHierarchy`, `ComponentUsageTable`, `RuntimeTree`, `useManifestData` |
| `@i2c/intelligence/types` | types/index | All TypeScript interfaces, type unions, `buildCanonicalId`, `parseCanonicalId`, `isBuiltinHook` |

### CLI Usage

```bash
intelligence --root ./my-project --app-dir src/app --output .generated/intelligence --no-cache
```

| Flag | Default | Description |
|---|---|---|
| `--root` | `process.cwd()` | Project root directory |
| `--app-dir` | `"app"` | App Router directory |
| `--output` | `".generated/intelligence"` | Output directory |
| `--no-cache` | `false` | Disable incremental caching |

### Output Files

| File | Content |
|---|---|
| `manifest.json` | Complete `IntelligenceManifest` (all data) |
| `graph.json` | Unified `DependencyGraph` |
| `routes.json` | `Record<string, RouteIntelligence>` |
| `runtime.json` | `Record<string, RuntimeMeta>` |
| `diagnostics.json` | `Diagnostic[]` |
| `graphs/import.json` | Import relationship graph |
| `graphs/render.json` | Render (JSX) relationship graph |
| `graphs/composite-ownership.json` | Composite component ownership graph |
| `graphs/runtime-mount.json` | Runtime mount graph |

### No HTTP API

This is a build tool / library, not a server. No REST/GraphQL endpoints.

---

## 10. Performance Strategies

| Strategy | Implementation | Location |
|---|---|---|
| **Incremental caching** | SHA-256 content hashing, skip unchanged files | `cache.ts` |
| **Lazy loading** | `React.lazy()` for `RouteFlowGraph` component | `dashboard.tsx` |
| **Symbol resolution caching** | In-memory `Map` cache in `SymbolResolver` | `symbol-resolver.ts` |
| **Iterative DFS** | `RecursiveTraverser` uses iterative (not recursive) DFS to avoid stack overflow | `recursive-traverser.ts` |
| **Visited set** | Prevents re-processing files in dependency tree | `recursive-traverser.ts` |
| **Edge deduplication** | `GraphBuilder.dedup()` prevents duplicate edges | `graph-builder.ts` |
| **Deterministic output** | `OutputWriter` sorts object keys for stable JSON diffs | `output-writer.ts` |
| **Parallel file writes** | `Promise.all()` for writing output files | `output-writer.ts` |
| **useRef for mutable state** | Runtime provider uses `useRef` to avoid re-renders on mount/unmount | `provider.tsx` |
| **AbortController** | Dashboard data fetching supports cancellation | `dashboard.tsx` |
| **MutationObserver** | Efficient SPA navigation detection without polling | `use-route-tracking.tsx` |

---

## 11. Developer Workflow

### Local Setup

```bash
git clone <repo>
cd nextJs-inteligence
npm install
```

### Build

```bash
npm run build
# Runs: tsc -p tsconfig.build.json && node scripts/fix-esm-imports.mjs
```

### Publish

```bash
npm publish --registry=https://artifacts-local.i2cinc.com/repository/dd-npm-private/
# prepublishOnly runs build automatically
```

### Scripts

| Script | Command | Notes |
|---|---|---|
| `build` | `tsc -p tsconfig.build.json && node scripts/fix-esm-imports.mjs` | Compiles all modules + fixes ESM imports |
| `prepublishOnly` | `npm run build` | Auto-runs before publish |
| `lint` | `echo "No lint step configured"` | Not implemented |
| `test` | `echo "No tests configured"` | Not implemented |

### Testing Workflow

Not enough evidence found — no test files, no test framework configured.

### Release Flow

Manual `npm publish` to private Artifactory registry. Version is bumped manually in `package.json`.

---

## 12. Known Problems / Technical Debt

### No Tests

No test suite exists. All scripts echo "No tests configured". This is the most critical gap.

### No Linting

No ESLint or Prettier configuration. Code style is enforced only by convention.

### Deep Relative Import Paths

Cross-module imports use fragile relative paths like `../../intelligence-core/src/analyzer/classifier`. Any folder restructuring would break these. Consider path aliases or workspace references.

### Unused `inferComponentType` in Transform

`transform.ts` calls `classifyComponent` from the core analyzer to infer component types, creating a build-time dependency on the analysis engine for what is a simple heuristic task.

### Registry Singleton Pattern

`IntelligenceRegistry` uses a classic singleton. This makes testing harder and prevents parallel analysis of multiple projects in the same process.

### No Input Validation at CLI Boundary

`cli.ts` performs minimal argument parsing with no validation, no help text, and no error messages for invalid flags.

### Pipeline Error Swallowing

`withIntelligence()` catches all pipeline errors and logs them, but silently continues. This could mask critical analysis failures.

### Dashboard Inline Styles

The entire dashboard UI uses inline styles. This makes theming, responsive design, and style customization difficult.

### Incomplete `IncrementalCache` Integration

The cache is loaded and saved in the pipeline, but `hasChanged()` and `update()` are never called during actual component analysis. The cache infrastructure exists but isn't wired into the analyzer loop.

### Sub-module `package.json` Files Are Dead Weight

Each module has its own `package.json` with scripts like `build: echo "No build step required"`. These serve no functional purpose since everything is built from the root.

### TODO/FIXME Hotspots

Not enough evidence found — no TODO or FIXME comments detected in the source.

---

## 13. AI Guidance Section

### Architectural Rules AI Must Follow

1. **Canonical IDs are sacred.** Always use `relativePath#exportName` format. Never invent alternative ID schemes. Use `buildCanonicalId()` from `intelligence-types`.

2. **Dependency direction is strict.** Types ← Core ← {Compiler, Runtime} ← Dashboard. Never add imports that violate this layering.

3. **Separated graphs must stay separated.** Import, Render, Ownership, and Mount graphs are semantically distinct. Never merge edge types or conflate relationship meanings.

4. **`"use client"` is meaningful.** The runtime hooks REQUIRE the `"use client"` directive. Server components CANNOT use hooks. The analyzer correctly distinguishes these.

5. **All component classification goes through `classifyComponent()`.** Do not create alternative classification paths. Extend via `ClassificationRule[]` if needed.

6. **The pipeline is sequential (Phases 1–8).** Each phase depends on prior phase output. Do not reorder or parallelize phases.

### Things AI Must NOT Change

- The `CanonicalIdentity` interface or `buildCanonicalId()` function — downstream systems depend on exact format
- The `IntelligenceManifest` interface — consumers parse this JSON contract
- The exports map in root `package.json` — consumer import paths depend on it
- The `"use client"` directives in runtime and dashboard files
- The 8-phase pipeline order in `pipeline.ts`
- The `ComponentType` union — adding types is OK, removing or renaming breaks classification

### Dangerous Areas

- **`transform.ts`**: Modifies user source code. Regex-based injection is fragile. Changes here can corrupt user files.
- **`fix-esm-imports.mjs`**: Post-build script modifies compiled output. A bug here breaks all imports in the published package.
- **`registry.ts` singleton**: `getInstance()` shares state globally. Clearing state (`clear()`) must happen before each pipeline run.
- **`next-plugin.ts`**: Runs during Next.js config resolution. Errors here can prevent the app from starting.

### Safe Extension Points

- **New `ClassificationRule` entries**: Add to `DEFAULT_CLASSIFICATION_RULES` array in `classifier.ts`
- **New `ComponentType` values**: Add to the union in `intelligence-types/src/index.ts`
- **New graph relationship types**: Add to `GraphEdge.relationship` union and handle in `GraphBuilder`
- **New verification checks**: Add methods to `VerificationPass` class
- **New diagnostic categories**: Add to `DiagnosticCategory` union
- **Dashboard views**: Add new components alongside existing dashboard modules
- **CLI flags**: Extend `parseArgs()` in `cli.ts`

### Existing Abstractions to Reuse

| Abstraction | Location | When to Use |
|---|---|---|
| `buildCanonicalId()` | `types/src/index.ts` | Generating any component identifier |
| `classifyComponent()` | `core/src/analyzer/classifier.ts` | Determining component type |
| `isBuiltinHook()` | `types/src/index.ts` | Filtering React/Next.js built-in hooks |
| `RecursiveTraverser` | `core/src/analyzer/recursive-traverser.ts` | Walking import trees |
| `SymbolResolver` | `core/src/analyzer/symbol-resolver.ts` | Resolving identifiers to canonical IDs |
| `OutputWriter` | `core/src/output-writer.ts` | Writing deterministic JSON files |
| `IncrementalCache` | `core/src/cache.ts` | File-level change detection |

### Coding Standards AI Must Follow

- Use **ts-morph** for any AST work — do not use raw TypeScript compiler API
- Use **canonical IDs** everywhere — never identify components by name alone
- Keep **classification in `classifier.ts`** — do not scatter classification logic
- Write **deterministic output** — sort keys, sort arrays, use `deterministicReplacer()`
- Use **`relative()` + `.replace(/\\/g, "/")`** for all path normalization
- Add **confidence metadata** (`ConfidenceMeta`) to all inferred relationships
- Emit **structured diagnostics** instead of `console.warn` for analysis issues

---

## 14. Smart Summaries

### Most Critical Files

| File | Why It Matters |
|---|---|
| `tools/intelligence-types/src/index.ts` | Every interface, type, and utility. The contract layer. |
| `tools/intelligence-core/src/pipeline.ts` | The 8-phase orchestrator. Entry point for all analysis. |
| `tools/intelligence-core/src/analyzer/component-analyzer.ts` | AST component extraction engine. Largest analyzer file. |
| `tools/intelligence-core/src/registry.ts` | Singleton data aggregator + manifest export. |
| `tools/intelligence-core/src/analyzer/graph-builder.ts` | Builds all 4 separated graphs. |
| `tools/intelligence-compiler/src/next-plugin.ts` | Integration point with consumer Next.js apps. |

### Most Important Entry Points

| Entry Point | How It's Reached |
|---|---|
| `withIntelligence()` | Called from consumer's `next.config.ts` |
| `runIntelligencePipeline()` | Called by CLI and by `withIntelligence()` |
| `IntelligenceProvider` | Wrapped around consumer's root layout |
| `IntelligenceDashboard` | Mounted in a dev-only page |
| `intelligence` CLI | `npx intelligence` or `node dist/tools/intelligence-core/src/cli.js` |

### Most Reused Utilities

| Utility | Used By |
|---|---|
| `buildCanonicalId()` | component-analyzer, recursive-traverser, canonicalizer, composite-detector, symbol-resolver, transform |
| `isBuiltinHook()` | recursive-traverser, route-intelligence-builder |
| `classifyComponent()` | component-analyzer, transform |
| `relative() + path normalization` | Every file in the analyzer directory |

### Most Central Abstractions

| Abstraction | Centrality |
|---|---|
| `ComponentMeta` | Used by every phase of the pipeline, the registry, graphs, dashboard, and runtime |
| `CanonicalIdentity` | Foundation for all identity resolution — the single source of truth |
| `IntelligenceManifest` | The complete output contract — consumed by dashboard, external tools, and AI agents |
| `SeparatedGraphs` | Structured graph output — consumed by visualization and analysis |
| `RouteIntelligence` | Per-route dependency analysis — the primary query surface |
