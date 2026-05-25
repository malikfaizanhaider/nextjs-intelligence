import { relative } from "node:path";
import {
  type Project,
  type SourceFile,
  type Symbol as TsMorphSymbol,
  type Node,
  SyntaxKind,
} from "ts-morph";
import {
  buildCanonicalId,
  type CanonicalIdentity,
  type ConfidenceMeta,
} from "../../../intelligence-types/src/index";

/**
 * Resolved symbol information for a JSX tag or import reference.
 */
export interface ResolvedSymbol {
  /** Canonical identity of the resolved component */
  identity: CanonicalIdentity;
  /** The local name used at the call site (may differ from export name due to aliasing) */
  localName: string;
  /** Whether this was resolved via symbol tracing (true) or fallback heuristic (false) */
  isSemanticResolution: boolean;
  /** Confidence in this resolution */
  confidence: ConfidenceMeta;
}

/**
 * TypeScript Symbol Resolution Engine.
 *
 * Resolves JSX tags and import references to their canonical identities
 * using ts-morph's type checker and symbol APIs. Does NOT rely on string matching.
 *
 * Handles:
 * - Direct imports: `import { DataGrid } from "./data-grid"`
 * - Default imports: `import DataGrid from "./data-grid"`
 * - Aliased imports: `import { DataGrid as MyGrid } from "./data-grid"`
 * - Barrel exports: `export { DataGrid } from "./data-grid"`
 * - Re-exports: `export * from "./data-grid"`
 * - Namespace imports: `import * as Grid from "./data-grid"`
 * - Path aliases: `@/`, `@ui/`, etc. (via tsconfig)
 * - Dotted JSX: `<DataGrid.Header />`
 */
export class SymbolResolver {
  private project: Project;
  private projectRoot: string;
  /** Cache: sourceFilePath + localName → ResolvedSymbol */
  private cache = new Map<string, ResolvedSymbol | null>();

  constructor(project: Project, projectRoot: string) {
    this.project = project;
    this.projectRoot = projectRoot;
  }

  /**
   * Resolve a JSX tag node to its canonical identity.
   * Works for both simple tags (<DataGrid />) and dotted tags (<DataGrid.Header />).
   */
  resolveJsxTag(tagNode: Node, sourceFile: SourceFile): ResolvedSymbol | null {
    const tagText = tagNode.getText();

    // Handle dotted notation: DataGrid.Header
    if (tagText.includes(".")) {
      return this.resolveDottedJsxTag(tagText, tagNode, sourceFile);
    }

    return this.resolveIdentifier(tagText, tagNode, sourceFile);
  }

  /**
   * Resolve a simple identifier (component name) to its canonical identity
   * using ts-morph symbol resolution.
   */
  resolveIdentifier(name: string, node: Node, sourceFile: SourceFile): ResolvedSymbol | null {
    const cacheKey = `${sourceFile.getFilePath()}:${name}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    // Strategy 1: Use the type checker to find the symbol at the node position
    const symbol = this.getSymbolAtNode(node);
    if (symbol) {
      const resolved = this.traceSymbolToDeclaration(symbol, name);
      if (resolved) {
        this.cache.set(cacheKey, resolved);
        return resolved;
      }
    }

    // Strategy 2: Find the import declaration that brings this name into scope
    const importResolved = this.resolveViaImportDeclaration(name, sourceFile);
    if (importResolved) {
      this.cache.set(cacheKey, importResolved);
      return importResolved;
    }

    // Strategy 3: Check if the name is declared locally in this file
    const localResolved = this.resolveLocalDeclaration(name, sourceFile);
    if (localResolved) {
      this.cache.set(cacheKey, localResolved);
      return localResolved;
    }

    this.cache.set(cacheKey, null);
    return null;
  }

  /**
   * Resolve a dotted JSX tag like DataGrid.Header.
   * Returns the identity of the ROOT (DataGrid), with metadata about the sub-component.
   */
  private resolveDottedJsxTag(
    tagText: string,
    tagNode: Node,
    sourceFile: SourceFile
  ): ResolvedSymbol | null {
    const parts = tagText.split(".");
    const rootName = parts[0]!;

    // Resolve the root identifier
    const rootResolved = this.resolveIdentifier(rootName, tagNode, sourceFile);
    if (!rootResolved) return null;

    // The resolved identity IS the root; the sub-component is tracked separately
    return {
      ...rootResolved,
      localName: tagText, // Keep the full dotted name for composite detection
    };
  }

  /**
   * Get the ts-morph Symbol at a given node.
   */
  private getSymbolAtNode(node: Node): TsMorphSymbol | undefined {
    try {
      // For JSX tag name nodes, get the symbol from the identifier
      const kind = node.getKind();

      if (kind === SyntaxKind.Identifier) {
        return node.getSymbol();
      }

      if (
        kind === SyntaxKind.PropertyAccessExpression ||
        kind === SyntaxKind.QualifiedName
      ) {
        // For dotted notation, get the symbol of the left-most identifier
        const firstChild = node.getFirstChildByKind(SyntaxKind.Identifier);
        return firstChild?.getSymbol();
      }

      // Try the node itself
      return node.getSymbol();
    } catch {
      return undefined;
    }
  }

  /**
   * Trace a Symbol through aliased symbols, re-exports, and barrel files
   * to find the original declaration site.
   */
  private traceSymbolToDeclaration(
    symbol: TsMorphSymbol,
    localName: string
  ): ResolvedSymbol | null {
    try {
      // Get the aliased symbol if this is a re-export or alias
      const resolvedSymbol = this.getOriginalSymbol(symbol);
      const declarations = resolvedSymbol.getDeclarations();

      if (declarations.length === 0) return null;

      // Find the actual source declaration (not the re-export)
      for (const decl of declarations) {
        const declSourceFile = decl.getSourceFile();
        const declFilePath = declSourceFile.getFilePath().replace(/\\/g, "/");

        // Skip node_modules declarations
        if (declFilePath.includes("node_modules")) continue;

        const relativePath = relative(this.projectRoot, declFilePath).replace(
          /\\/g,
          "/"
        );

        // Determine the export name
        const exportName = resolvedSymbol.getName();
        const canonicalId = buildCanonicalId(relativePath, exportName);

        return {
          identity: {
            canonicalId,
            sourceFile: relativePath,
            exportName,
            absolutePath: declFilePath,
            compositeRoot: null,
          },
          localName,
          isSemanticResolution: true,
          confidence: {
            score: 0.95,
            evidence: ["symbol-resolution"],
          },
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Follow the alias chain to the original symbol.
   * Handles: import alias → re-export → barrel → original declaration.
   */
  private getOriginalSymbol(symbol: TsMorphSymbol): TsMorphSymbol {
    try {
      const aliased = symbol.getAliasedSymbol();
      if (aliased && aliased !== symbol) {
        // Recurse to handle chains of re-exports
        return this.getOriginalSymbol(aliased);
      }
    } catch {
      // getAliasedSymbol throws if no alias exists
    }
    return symbol;
  }

  /**
   * Resolve a name via the import declarations in a source file.
   * Handles named imports, default imports, aliased imports, namespace imports.
   */
  private resolveViaImportDeclaration(
    name: string,
    sourceFile: SourceFile
  ): ResolvedSymbol | null {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
      if (!moduleSourceFile) continue;

      const targetFilePath = moduleSourceFile.getFilePath().replace(/\\/g, "/");
      if (targetFilePath.includes("node_modules")) continue;

      const targetRelPath = relative(this.projectRoot, targetFilePath).replace(
        /\\/g,
        "/"
      );

      // Check named imports
      for (const namedImport of importDecl.getNamedImports()) {
        const importedName = namedImport.getName();
        const alias = namedImport.getAliasNode()?.getText();
        const localUsedName = alias ?? importedName;

        if (localUsedName === name) {
          // Trace through the imported symbol to find the real declaration
          const symbol = namedImport.getNameNode().getSymbol();
          if (symbol) {
            const traced = this.traceSymbolToDeclaration(symbol, name);
            if (traced) return traced;
          }

          // Fallback: use the module file + import name
          const canonicalId = buildCanonicalId(targetRelPath, importedName);
          return {
            identity: {
              canonicalId,
              sourceFile: targetRelPath,
              exportName: importedName,
              absolutePath: targetFilePath,
              compositeRoot: null,
            },
            localName: name,
            isSemanticResolution: false,
            confidence: {
              score: 0.85,
              evidence: ["import-graph"],
            },
          };
        }
      }

      // Check default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport && defaultImport.getText() === name) {
        const symbol = defaultImport.getSymbol();
        if (symbol) {
          const traced = this.traceSymbolToDeclaration(symbol, name);
          if (traced) return traced;
        }

        const canonicalId = buildCanonicalId(targetRelPath, "default");
        return {
          identity: {
            canonicalId,
            sourceFile: targetRelPath,
            exportName: "default",
            absolutePath: targetFilePath,
            compositeRoot: null,
          },
          localName: name,
          isSemanticResolution: false,
          confidence: {
            score: 0.8,
            evidence: ["import-graph"],
          },
        };
      }

      // Check namespace import: import * as Grid from "./data-grid"
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport && namespaceImport.getText() === name) {
        const canonicalId = buildCanonicalId(targetRelPath, "*");
        return {
          identity: {
            canonicalId,
            sourceFile: targetRelPath,
            exportName: "*",
            absolutePath: targetFilePath,
            compositeRoot: null,
          },
          localName: name,
          isSemanticResolution: false,
          confidence: {
            score: 0.75,
            evidence: ["import-graph"],
          },
        };
      }
    }

    return null;
  }

  /**
   * Resolve a name declared locally in the current source file.
   */
  private resolveLocalDeclaration(
    name: string,
    sourceFile: SourceFile
  ): ResolvedSymbol | null {
    const filePath = sourceFile.getFilePath().replace(/\\/g, "/");
    const relativePath = relative(this.projectRoot, filePath).replace(
      /\\/g,
      "/"
    );

    // Check exported functions
    for (const fn of sourceFile.getFunctions()) {
      if (fn.getName() === name && fn.isExported()) {
        const canonicalId = buildCanonicalId(relativePath, name);
        return {
          identity: {
            canonicalId,
            sourceFile: relativePath,
            exportName: name,
            absolutePath: filePath,
            compositeRoot: null,
          },
          localName: name,
          isSemanticResolution: true,
          confidence: {
            score: 0.95,
            evidence: ["symbol-resolution"],
          },
        };
      }
    }

    // Check exported variable declarations
    for (const varStatement of sourceFile.getVariableStatements()) {
      if (!varStatement.isExported()) continue;
      for (const decl of varStatement.getDeclarations()) {
        if (decl.getName() === name) {
          const canonicalId = buildCanonicalId(relativePath, name);
          return {
            identity: {
              canonicalId,
              sourceFile: relativePath,
              exportName: name,
              absolutePath: filePath,
              compositeRoot: null,
            },
            localName: name,
            isSemanticResolution: true,
            confidence: {
              score: 0.95,
              evidence: ["symbol-resolution"],
            },
          };
        }
      }
    }

    return null;
  }

  /**
   * Resolve all JSX tags in a source file to their canonical identities.
   * Returns a map of localTagName → ResolvedSymbol.
   */
  resolveAllJsxTags(sourceFile: SourceFile): Map<string, ResolvedSymbol> {
    const results = new Map<string, ResolvedSymbol>();

    const processTagNode = (tagNameNode: Node) => {
      const tagText = tagNameNode.getText();
      if (!this.isComponentName(tagText)) return;

      // Skip if already resolved
      if (results.has(tagText)) return;

      const resolved = this.resolveJsxTag(tagNameNode, sourceFile);
      if (resolved) {
        results.set(tagText, resolved);
      }
    };

    for (const el of sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
      processTagNode(el.getTagNameNode());
    }

    for (const el of sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
      processTagNode(el.getTagNameNode());
    }

    return results;
  }

  /**
   * Check if a name looks like a React component (PascalCase).
   */
  private isComponentName(name: string): boolean {
    if (!name) return false;
    const baseName = name.includes(".") ? name.split(".")[0]! : name;
    return /^[A-Z][a-zA-Z0-9]*/.test(baseName) && !/^[A-Z_]+$/.test(baseName);
  }

  /**
   * Clear the resolution cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
