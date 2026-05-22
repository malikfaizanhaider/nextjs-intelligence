import { relative } from "node:path";
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

  constructor(project: Project, projectRoot: string) {
    this.project = project;
    this.projectRoot = projectRoot;
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
    return {
      dependencies: this.dependencies,
      maxDepth: this.maxDepth,
      allFiles: this.allFiles,
      hooks: this.hooks,
      utils: this.utils,
      providers: this.providers,
      components: this.components,
      componentNames: this.componentNames,
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

    const deps = this.extractDependencies(sourceFile, depth);
    if (deps.length > 0) {
      this.dependencies.set(relPath, deps);
    }

    // Also extract hooks used in this file (call expressions starting with "use")
    this.extractHookUsage(sourceFile);

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
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind, depth: depth + 1 });
        this.trackByKind(name, canonicalId, kind);
      }

      // Process default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const name = defaultImport.getText();
        const kind = this.classifyExport(name, relativePath);
        const canonicalId = buildCanonicalId(relativePath, name);
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind, depth: depth + 1 });
        this.trackByKind(name, canonicalId, kind);
      }

      // Process namespace imports
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const name = namespaceImport.getText();
        const canonicalId = buildCanonicalId(relativePath, "*");
        deps.push({ relativePath, absolutePath, exportName: name, canonicalId, kind: "unknown", depth: depth + 1 });
      }

      // If only type imports, mark as type
      if (importDecl.isTypeOnly()) {
        for (const dep of deps.filter((d) => d.absolutePath === absolutePath)) {
          dep.kind = "type";
        }
      }
    }

    return deps;
  }

  /**
   * Extract hook usage from call expressions (useXxx patterns).
   * Filters out React/Next.js built-in hooks.
   */
  private extractHookUsage(sourceFile: SourceFile): void {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const expression = call.getExpression();
      const text = expression.getText();

      if (/^use[A-Z]/.test(text) && !isBuiltinHook(text)) {
        this.hooks.add(text);
      }
    }
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
