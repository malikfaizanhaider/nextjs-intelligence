import { relative, resolve as resolvePath } from "node:path";
import type { SourceFile, Project } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import { isBuiltinHook, buildCanonicalId } from "../../../intelligence-types/src/index";

/**
 * Represents a resolved dependency discovered during recursive traversal.
 */
export interface ResolvedDependency {
  /** Relative file path from project root */
  relativePath: string;
  /** Absolute file path */
  absolutePath: string;
  /** The name of the export used */
  exportName: string;
  /** Canonical ID of the dependency */
  canonicalId: string;
  /** Classification of the dependency */
  kind: "component" | "hook" | "util" | "provider" | "type" | "unknown";
  /** Depth at which this dependency was found */
  depth: number;
  /**
   * True when the dependency was discovered through a lazy mechanism:
   *   - `next/dynamic` factory call (`dynamic(() => import("..."))`)
   *   - Bare dynamic `import("...")` expression
   *
   * Eager static imports are `false`. Used by Phase C4 to split a route's
   * dependency tree into eager and lazy buckets.
   */
  isLazy: boolean;
}

/**
 * Result of a full recursive traversal from a root file.
 */
export interface TraversalResult {
  /** All dependencies keyed by relative path */
  dependencies: Map<string, ResolvedDependency[]>;
  /** Maximum depth reached */
  maxDepth: number;
  /** All file paths in the dependency tree */
  allFiles: Set<string>;
  /** Hooks discovered at any depth */
  hooks: Set<string>;
  /** Utility functions discovered at any depth */
  utils: Set<string>;
  /** Providers discovered at any depth */
  providers: Set<string>;
  /** Components discovered at any depth (canonical IDs) */
  components: Set<string>;
  /** Component names discovered at any depth */
  componentNames: Set<string>;
  /**
   * Canonical IDs of components that were reached *exclusively* via lazy
   * imports (`next/dynamic` or bare `import()` calls). A component that has
   * even one eager import path is considered eager (it appears in `components`
   * but not in `lazyComponents`).
   */
  lazyComponents: Set<string>;
}

/**
 * Recursively traverse the dependency tree from a root file.
 * Does NOT stop at direct imports — walks the entire tree.
 *
 * Uses ts-morph module resolution to follow actual TypeScript compiler
 * resolution rules. Does NOT hardcode path aliases — reads from tsconfig.
 *
 * Memory-efficient: uses iterative DFS with visited tracking.
 */
/**
 * Cached per-file analysis results, shared across multiple traversals.
 *
 * The list of dependencies (and the set of hooks called) for a given source file
 * is invariant for a fixed ts-morph {@link Project}. Hoisting these results out of
 * a single traversal lets callers (e.g. `RouteIntelligenceBuilder`) reuse the
 * same per-file analysis across every route — turning the per-route DFS from
 * O(routes × transitive-imports) to O(transitive-imports) after warm-up.
 */
export interface TraversalCache {
  /** Hit/miss counters, useful for benchmarks and diagnostics. */
  readonly stats: { hits: number; misses: number };
  /** Returns cached deps for `absolutePath` if present, else `undefined`. */
  getDeps(absolutePath: string): ResolvedDependency[] | undefined;
  /** Stores the dep list for a file. */
  setDeps(absolutePath: string, deps: ResolvedDependency[]): void;
  /** Returns cached hook names called from `absolutePath`, or `undefined`. */
  getHooks(absolutePath: string): string[] | undefined;
  /** Stores hook names extracted from a file. */
  setHooks(absolutePath: string, hooks: string[]): void;
  /** Resets all cached entries (e.g. when the ts-morph project is rebuilt). */
  clear(): void;
}

/**
 * Default {@link TraversalCache} implementation backed by in-memory Maps.
 */
export class InMemoryTraversalCache implements TraversalCache {
  readonly stats = { hits: 0, misses: 0 };
  private depsByFile = new Map<string, ResolvedDependency[]>();
  private hooksByFile = new Map<string, string[]>();

  getDeps(absolutePath: string): ResolvedDependency[] | undefined {
    const value = this.depsByFile.get(absolutePath);
    if (value === undefined) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    return value;
  }

  setDeps(absolutePath: string, deps: ResolvedDependency[]): void {
    this.depsByFile.set(absolutePath, deps);
  }

  getHooks(absolutePath: string): string[] | undefined {
    return this.hooksByFile.get(absolutePath);
  }

  setHooks(absolutePath: string, hooks: string[]): void {
    this.hooksByFile.set(absolutePath, hooks);
  }

  clear(): void {
    this.depsByFile.clear();
    this.hooksByFile.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}

export class RecursiveTraverser {
  private project: Project;
  private projectRoot: string;
  private visited = new Set<string>();
  private dependencies = new Map<string, ResolvedDependency[]>();
  private maxDepth = 0;
  private allFiles = new Set<string>();
  private hooks = new Set<string>();
  private utils = new Set<string>();
  private providers = new Set<string>();
  private components = new Set<string>();
  private componentNames = new Set<string>();
  /**
   * Canonical IDs that have been observed through at least one eager import path.
   * Used at the end of a traversal to compute `lazyComponents = lazyCandidates − eagerSeen`.
   */
  private eagerSeen = new Set<string>();
  /** Canonical IDs first observed through a lazy edge. */
  private lazyCandidates = new Set<string>();
  private cache: TraversalCache | null;

  constructor(project: Project, projectRoot: string, cache?: TraversalCache | null) {
    this.project = project;
    this.projectRoot = projectRoot;
    this.cache = cache ?? null;
  }

  /**
   * Traverse all dependencies starting from a root file.
   */
  traverse(rootFilePath: string): TraversalResult {
    this.reset();
    this.walkFile(rootFilePath, 0);
    return this.getResult();
  }

  /**
   * Traverse multiple root files (e.g. page + layout + template).
   */
  traverseMultiple(rootFiles: string[]): TraversalResult {
    this.reset();
    for (const filePath of rootFiles) {
      this.walkFile(filePath, 0);
    }
    return this.getResult();
  }

  private getResult(): TraversalResult {
    // A canonical ID is "lazy" if it was reached through a lazy edge AND was
    // never reached through any eager edge. This avoids reporting a component
    // as lazy when one route imports it eagerly and another reaches it through
    // `next/dynamic`.
    const lazyComponents = new Set<string>();
    for (const id of this.lazyCandidates) {
      if (!this.eagerSeen.has(id)) {
        lazyComponents.add(id);
      }
    }
    return {
      dependencies: this.dependencies,
      maxDepth: this.maxDepth,
      allFiles: this.allFiles,
      hooks: this.hooks,
      utils: this.utils,
      providers: this.providers,
      components: this.components,
      componentNames: this.componentNames,
      lazyComponents,
    };
  }

  private reset(): void {
    this.visited.clear();
    this.dependencies.clear();
    this.maxDepth = 0;
    this.allFiles.clear();
    this.hooks.clear();
    this.utils.clear();
    this.providers.clear();
    this.components.clear();
    this.componentNames.clear();
    this.eagerSeen.clear();
    this.lazyCandidates.clear();
  }

  /**
   * Iterative DFS walk of a file's import tree.
   */
  private walkFile(filePath: string, depth: number): void {
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (this.visited.has(normalizedPath)) return;
    this.visited.add(normalizedPath);

    if (depth > this.maxDepth) {
      this.maxDepth = depth;
    }

    const sourceFile = this.project.getSourceFile(normalizedPath);
    if (!sourceFile) return;

    const relPath = relative(this.projectRoot, normalizedPath).replace(/\\/g, "/");
    this.allFiles.add(relPath);

    // Per-file dependency list and hook usage are invariant for a fixed project,
    // so we look them up in the shared cache before falling back to AST work.
    let deps = this.cache?.getDeps(normalizedPath);
    if (!deps) {
      deps = this.extractDependencies(sourceFile, depth);
      this.cache?.setDeps(normalizedPath, deps);
    }
    // Re-track kind buckets for THIS traversal (kind-bucket state is per-run).
    for (const dep of deps) {
      this.trackByKind(dep.exportName, dep.canonicalId, dep.kind);
      if (dep.kind === "component") {
        if (dep.isLazy) {
          this.lazyCandidates.add(dep.canonicalId);
        } else {
          this.eagerSeen.add(dep.canonicalId);
        }
      }
    }
    if (deps.length > 0) {
      this.dependencies.set(relPath, deps);
    }

    let hookNames = this.cache?.getHooks(normalizedPath);
    if (!hookNames) {
      hookNames = this.extractHookNames(sourceFile);
      this.cache?.setHooks(normalizedPath, hookNames);
    }
    for (const name of hookNames) {
      this.hooks.add(name);
    }

    // Recurse into local imports
    for (const dep of deps) {
      if (dep.kind !== "type") {
        this.walkFile(dep.absolutePath, depth + 1);
      }
    }
  }

  /**
   * Extract all local import dependencies from a source file.
   * Uses ts-morph module resolution — follows actual compiler resolution rules.
   * Does NOT hardcode path aliases.
   *
   * Includes both eager static imports (`isLazy: false`) and lazy imports
   * (`isLazy: true`) — the latter discovered via:
   *   - `next/dynamic` factory calls: `dynamic(() => import("./foo"))`
   *   - bare dynamic `import("./foo")` expressions
   */
  private extractDependencies(sourceFile: SourceFile, depth: number): ResolvedDependency[] {
    const deps: ResolvedDependency[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      // Use ts-morph to resolve the module specifier
      // This automatically handles: relative paths, path aliases (@/, @ui/),
      // baseUrl, workspace references, and package exports via tsconfig
      const resolvedSource = importDecl.getModuleSpecifierSourceFile();
      if (!resolvedSource) continue;

      const absolutePath = resolvedSource.getFilePath().replace(/\\/g, "/");
      const relativePath = relative(this.projectRoot, absolutePath).replace(/\\/g, "/");

      // Skip external modules
      if (this.isExcludedPath(relativePath)) continue;

      // Process named imports
      for (const namedImport of importDecl.getNamedImports()) {
        const name = namedImport.getName();
        const kind = this.classifyExport(name, relativePath);
        const canonicalId = buildCanonicalId(relativePath, name);
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind, depth: depth + 1, isLazy: false });
      }

      // Process default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const name = defaultImport.getText();
        const kind = this.classifyExport(name, relativePath);
        const canonicalId = buildCanonicalId(relativePath, name);
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind, depth: depth + 1, isLazy: false });
      }

      // Process namespace imports
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const name = namespaceImport.getText();
        const canonicalId = buildCanonicalId(relativePath, "*");
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind: "unknown", depth: depth + 1, isLazy: false });
      }

      // If only type imports, mark as type
      if (importDecl.isTypeOnly()) {
        for (const dep of deps.filter((d) => d.absolutePath === absolutePath)) {
          dep.kind = "type";
        }
      }
    }

    // Lazy imports: `next/dynamic` and bare `import()` expressions.
    deps.push(...this.extractLazyDependencies(sourceFile, depth));

    return deps;
  }

  /**
   * Extract lazy dependencies — components reached through `next/dynamic` or
   * a bare dynamic `import()` call. Returned deps are marked `isLazy: true`.
   *
   * The component "export name" assigned to each lazy dep follows these rules:
   *   - `const X = dynamic(() => import("./foo"))`            → exportName = "X"
   *   - `dynamic(() => import("./foo"), { ssr: false })`       → exportName = "default"
   *   - bare `import("./foo")` outside a dynamic() wrapper     → exportName = "default"
   *
   * Sub-symbol selection (`.then(m => m.Foo)`) is honored when present.
   */
  private extractLazyDependencies(
    sourceFile: SourceFile,
    depth: number
  ): ResolvedDependency[] {
    const out: ResolvedDependency[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const exprKind = expression.getKind();

      // Case 1: bare `import("./foo")`
      if (exprKind === SyntaxKind.ImportKeyword) {
        const dep = this.resolveLazyCall(call, sourceFile, depth, /*assignedName*/ null);
        if (dep) out.push(dep);
        continue;
      }

      // Case 2: `dynamic(() => import("./foo"))` — the inner `import(...)`
      // call is itself a CallExpression handled above. We additionally surface
      // the assigned name when `dynamic()` is the initializer of a const decl
      // so the lazy component shows up under its declared identifier.
      const exprText = expression.getText();
      if (exprText === "dynamic" || exprText.endsWith(".dynamic")) {
        const assigned = this.findAssignedName(call);
        const inner = call.getDescendantsOfKind(SyntaxKind.CallExpression)
          .find((c) => c.getExpression().getKind() === SyntaxKind.ImportKeyword);
        if (inner) {
          const dep = this.resolveLazyCall(inner, sourceFile, depth, assigned);
          if (dep) {
            // Avoid double-counting: the inner bare-import handler above would
            // have produced an entry with exportName="default"; replace it
            // when we have a more specific assigned name.
            if (assigned) {
              for (let i = out.length - 1; i >= 0; i--) {
                if (
                  out[i]!.absolutePath === dep.absolutePath &&
                  out[i]!.exportName === "default" &&
                  out[i]!.isLazy
                ) {
                  out.splice(i, 1);
                  break;
                }
              }
            }
            out.push(dep);
          }
        }
      }
    }

    return out;
  }

  /**
   * Resolve a single `import("./path")` call expression to a ResolvedDependency,
   * or `null` if the specifier cannot be statically resolved.
   */
  private resolveLazyCall(
    importCall: import("ts-morph").CallExpression,
    sourceFile: SourceFile,
    depth: number,
    assignedName: string | null
  ): ResolvedDependency | null {
    const args = importCall.getArguments();
    if (args.length === 0) return null;
    const first = args[0]!;
    if (first.getKind() !== SyntaxKind.StringLiteral) return null;
    const specifier = (first as unknown as { getLiteralText: () => string }).getLiteralText();

    const moduleSourceFile = this.resolveModuleSpecifier(sourceFile, specifier);
    if (!moduleSourceFile) return null;

    const absolutePath = moduleSourceFile.getFilePath().replace(/\\/g, "/");
    const relativePath = relative(this.projectRoot, absolutePath).replace(/\\/g, "/");
    if (this.isExcludedPath(relativePath)) return null;

    // For a lazy import like `import("./modal")`, the `exportName` we record
    // is "default" (lazy default import) or the const we are assigned to
    // (`const Modal = dynamic(...)`). Neither is guaranteed to match the
    // PascalCase display name component-analyzer assigned to the file.
    // Fix: when we'd otherwise label the dep as "default", try to recover the
    // component's display name from the file's default-exported declaration,
    // or from the file's basename. The canonicalId is rebuilt to match the
    // component-analyzer convention (which uses the function name, not the
    // literal string "default"); without this, downstream byId lookups fail.
    let exportName = assignedName ?? "default";
    let kind = this.classifyExport(exportName, relativePath);
    if (exportName === "default") {
      const recovered = this.recoverDefaultExportName(moduleSourceFile, relativePath);
      if (recovered) {
        exportName = recovered;
        kind = this.classifyExport(recovered, relativePath);
      } else if (/\.(tsx|jsx)$/i.test(relativePath)) {
        // .tsx default export without an obvious name — still treat as a component.
        kind = "component";
      }
    }
    const canonicalId = buildCanonicalId(relativePath, exportName);
    return {
      relativePath,
      absolutePath,
      exportName,
      canonicalId,
      kind,
      depth: depth + 1,
      isLazy: true,
    };
  }

  /**
   * Try to determine the display name of a source file's default export.
   * Falls back to the file basename converted to PascalCase. Returns null only
   * when neither yields a usable identifier.
   */
  private recoverDefaultExportName(
    moduleSourceFile: SourceFile,
    relativePath: string
  ): string | null {
    // Look for `export default function Foo` or `export default class Foo`.
    for (const fn of moduleSourceFile.getFunctions()) {
      if (fn.isDefaultExport()) {
        const name = fn.getName();
        if (name) return name;
      }
    }
    for (const cls of moduleSourceFile.getClasses()) {
      if (cls.isDefaultExport()) {
        const name = cls.getName();
        if (name) return name;
      }
    }
    // `export default Foo` where `Foo` is a local identifier — read its text.
    const assignment = moduleSourceFile.getExportAssignment((a) => !a.isExportEquals());
    if (assignment) {
      const expr = assignment.getExpression();
      if (expr && expr.getKind() === SyntaxKind.Identifier) {
        return expr.getText();
      }
    }
    // Fall back to the file basename ("modal" → "Modal").
    const base = relativePath.split("/").pop()?.replace(/\.(tsx?|jsx?)$/i, "") ?? "";
    if (!base) return null;
    const pascal = base
      .split(/[-_.]/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("");
    return pascal || null;
  }

  /**
   * Resolve a module specifier to a SourceFile. Primary path: add a synthetic
   * `import` declaration so ts-morph performs the full compiler resolution
   * (path aliases, baseUrl, conditional exports). Fallback path: relative
   * filesystem resolution against the importing file with the standard
   * TypeScript extension search order.
   */
  private resolveModuleSpecifier(
    sourceFile: SourceFile,
    specifier: string
  ): SourceFile | null {
    try {
      const synthetic = sourceFile.addImportDeclaration({
        moduleSpecifier: specifier,
        namedImports: [],
      });
      const resolved = synthetic.getModuleSpecifierSourceFile() ?? null;
      synthetic.remove();
      if (resolved) return resolved;
    } catch {
      // fall through to relative resolution
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
    const importerDir = sourceFile.getDirectoryPath();
    // ts-morph stores paths with forward slashes regardless of OS. resolvePath
    // returns OS-native separators on Windows, so normalize the result before
    // performing project lookups.
    const candidate = resolvePath(importerDir, specifier).replace(/\\/g, "/");
    const project = sourceFile.getProject();
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    const indexBases = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
    for (const ext of extensions) {
      const found = project.getSourceFile(candidate + ext);
      if (found) return found;
    }
    for (const idx of indexBases) {
      const found = project.getSourceFile(candidate + idx);
      if (found) return found;
    }
    return null;
  }

  /**
   * If the given call expression is the initializer of a `const X = ...`
   * variable declaration, returns "X". Otherwise `null`.
   */
  private findAssignedName(
    callOrAncestor: import("ts-morph").Node
  ): string | null {
    let current: import("ts-morph").Node | undefined = callOrAncestor.getParent();
    while (current) {
      if (current.getKind() === SyntaxKind.VariableDeclaration) {
        const name = (current as unknown as {
          getName: () => string;
        }).getName();
        return name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : null;
      }
      current = current.getParent();
    }
    return null;
  }

  /**
   * Extract hook names from call expressions (useXxx patterns).
   * Pure: returns the names without mutating instance state, so results are cacheable.
   * Built-in React/Next.js hooks are filtered out.
   */
  private extractHookNames(sourceFile: SourceFile): string[] {
    const out = new Set<string>();
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const expression = call.getExpression();
      const text = expression.getText();
      if (/^use[A-Z]/.test(text) && !isBuiltinHook(text)) {
        out.add(text);
      }
    }
    return Array.from(out);
  }

  /**
   * Classify an exported name by its naming convention and file path.
   */
  private classifyExport(name: string, filePath: string): ResolvedDependency["kind"] {
    if (/^use[A-Z]/.test(name)) {
      return isBuiltinHook(name) ? "unknown" : "hook";
    }

    if (
      /Provider$/i.test(name) ||
      /ConsumerProvider$/i.test(name) ||
      /Context$/i.test(name) ||
      /ContextProvider$/i.test(name)
    ) {
      return "provider";
    }

    if (/^[A-Z][a-zA-Z0-9]*/.test(name) && !/^[A-Z_]+$/.test(name)) return "component";

    if (/\butils?\b/i.test(filePath) || /\blib\b/i.test(filePath) || /\bhelpers?\b/i.test(filePath)) {
      return "util";
    }

    if (/\bhooks?\b/i.test(filePath)) return "hook";

    if (/^[a-z]/.test(name)) return "util";

    return "unknown";
  }

  /**
   * Track dependency by its kind into the appropriate set.
   */
  private trackByKind(name: string, canonicalId: string, kind: ResolvedDependency["kind"]): void {
    switch (kind) {
      case "hook":
        if (!isBuiltinHook(name)) {
          this.hooks.add(name);
        }
        break;
      case "util":
        this.utils.add(name);
        break;
      case "provider":
        this.providers.add(name);
        break;
      case "component":
        this.components.add(canonicalId);
        this.componentNames.add(name);
        break;
    }
  }

  /**
   * Check if a file path should be excluded from traversal.
   */
  private isExcludedPath(relativePath: string): boolean {
    return (
      relativePath.includes("node_modules") ||
      relativePath.includes(".next") ||
      relativePath.includes(".generated") ||
      relativePath.includes("dist/")
    );
  }
}
