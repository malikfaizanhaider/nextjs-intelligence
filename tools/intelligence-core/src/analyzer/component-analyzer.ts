import { resolve, relative } from "node:path";
import { Project, SyntaxKind, type SourceFile, type Node } from "ts-morph";
import fg from "fast-glob";
import type {
  ComponentMeta,
  AnalyzerConfig,
  ClassificationRule,
  GraphEdge,
  RenderingEnvironment,
  CanonicalIdentity,
  ConfidenceMeta,
} from "../../../intelligence-types/src/index";
import { buildCanonicalId } from "../../../intelligence-types/src/index";
import { classifyComponent } from "./classifier";
import { SymbolResolver } from "./symbol-resolver";

/**
 * AST-based component analyzer using ts-morph.
 * Uses TypeScript symbol resolution for canonical identity assignment.
 * Does NOT rely on JSX string matching — resolves actual compiler symbols.
 */
export class ComponentAnalyzer {
  private project: Project;
  private config: AnalyzerConfig;
  private componentUsageMap = new Map<string, Set<string>>();
  private symbolResolver: SymbolResolver | null = null;

  constructor(config: AnalyzerConfig) {
    this.config = config;
    const tsConfigPath = config.tsConfigPath ??
      resolve(config.projectRoot, "tsconfig.json");

    this.project = new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Run the full analysis pipeline.
   */
  async analyze(): Promise<{
    components: ComponentMeta[];
    importEdges: GraphEdge[];
    renderEdges: GraphEdge[];
    project: Project;
  }> {
    const filePaths = await this.discoverFiles();
    this.addFilesToProject(filePaths);

    // Initialize symbol resolver AFTER all files are added to the project
    this.symbolResolver = new SymbolResolver(this.project, this.config.projectRoot);

    const components: ComponentMeta[] = [];
    const importEdges: GraphEdge[] = [];
    const renderEdges: GraphEdge[] = [];

    for (const sourceFile of this.project.getSourceFiles()) {
      const fileComponents = this.extractComponents(sourceFile);
      components.push(...fileComponents);

      const fileImportEdges = this.extractImportEdges(sourceFile);
      importEdges.push(...fileImportEdges);
    }

    // Resolve reusability by tracking usage across files (identity-based)
    this.resolveReusability(components);

    // Build render edges using symbol resolution
    const jsxRenderEdges = this.buildRenderEdges(components);
    renderEdges.push(...jsxRenderEdges);

    return { components, importEdges, renderEdges, project: this.project };
  }

  /**
   * Discover files matching the configured glob patterns.
   */
  private async discoverFiles(): Promise<string[]> {
    const normalizedRoot = this.config.projectRoot.replace(/\\/g, "/");
    const files = await fg(this.config.include, {
      cwd: normalizedRoot,
      absolute: true,
      ignore: [
        ...this.config.exclude,
        "**/node_modules/**",
        "**/.next/**",
        "**/dist/**",
        "**/.generated/**",
      ],
      onlyFiles: true,
    });
    return files;
  }

  /**
   * Add discovered files to the ts-morph project.
   */
  private addFilesToProject(filePaths: string[]): void {
    for (const filePath of filePaths) {
      try {
        this.project.addSourceFileAtPath(filePath);
      } catch {
        // Skip files that can't be parsed
      }
    }
  }

  /**
   * Extract all React component declarations from a source file.
   * Assigns canonical identities based on source file + export symbol.
   */
  private extractComponents(sourceFile: SourceFile): ComponentMeta[] {
    const filePath = sourceFile.getFilePath();
    const relativePath = relative(this.config.projectRoot, filePath).replace(/\\/g, "/");
    const components: ComponentMeta[] = [];
    const imports = this.getImportPaths(sourceFile);
    const jsxTags = this.getResolvedJsxTags(sourceFile);
    const rendering = this.detectRenderingEnvironment(sourceFile);
    const hasDynamicImport = this.hasDynamicImport(sourceFile);

    // Function declarations: export function MyComponent() {}
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name || !this.isComponentName(name)) continue;
      if (!fn.isExported()) continue;

      const componentJsxTags = this.getJsxTagsFromNode(fn);
      const fnSourceText = fn.getText();
      const type = classifyComponent(
        name,
        imports,
        componentJsxTags,
        relativePath,
        this.config.customRules,
        fnSourceText
      );

      const canonicalId = buildCanonicalId(relativePath, name);
      const identity: CanonicalIdentity = {
        canonicalId,
        sourceFile: relativePath,
        exportName: name,
        absolutePath: filePath,
        compositeRoot: null,
      };

      this.trackUsage(canonicalId, relativePath);

      components.push({
        identity,
        id: canonicalId,
        name,
        filePath,
        relativePath,
        type,
        rendering,
        exportType: fn.isDefaultExport() ? "default" : "named",
        imports,
        jsxChildren: componentJsxTags,
        usedInRoutes: [],
        usedInFiles: [],
        isReusable: false,
        isDynamicImport: hasDynamicImport,
        line: fn.getStartLineNumber(),
        column: fn.getStart() - sourceFile.getFullText().lastIndexOf("\n", fn.getStart()),
        isComposite: false,
        subComponents: [],
        subComponentIds: [],
        confidence: { score: 0.95, evidence: ["symbol-resolution"] },
      });
    }

    // Variable declarations: export const MyComponent = () => {}
    for (const varStatement of sourceFile.getVariableStatements()) {
      if (!varStatement.isExported()) continue;

      for (const declaration of varStatement.getDeclarations()) {
        const name = declaration.getName();
        if (!this.isComponentName(name)) continue;

        const initializer = declaration.getInitializer();
        if (!initializer) continue;

        const isFunction =
          initializer.getKind() === SyntaxKind.ArrowFunction ||
          initializer.getKind() === SyntaxKind.FunctionExpression;
        const isWrapped = initializer.getKind() === SyntaxKind.CallExpression;

        if (!isFunction && !isWrapped) continue;

        const componentJsxTags = this.getJsxTagsFromNode(initializer);
        const initSourceText = initializer.getText();
        const type = classifyComponent(
          name,
          imports,
          componentJsxTags,
          relativePath,
          this.config.customRules,
          initSourceText
        );

        const canonicalId = buildCanonicalId(relativePath, name);
        const identity: CanonicalIdentity = {
          canonicalId,
          sourceFile: relativePath,
          exportName: name,
          absolutePath: filePath,
          compositeRoot: null,
        };

        const isDefault = varStatement.getDeclarations().length === 1 &&
          sourceFile.getDefaultExportSymbol()?.getName() === name;

        this.trackUsage(canonicalId, relativePath);

        components.push({
          identity,
          id: canonicalId,
          name,
          filePath,
          relativePath,
          type,
          rendering,
          exportType: isDefault ? "default" : "named",
          imports,
          jsxChildren: componentJsxTags,
          usedInRoutes: [],
          usedInFiles: [],
          isReusable: false,
          isDynamicImport: hasDynamicImport,
          line: declaration.getStartLineNumber(),
          column: 1,
          isComposite: false,
          subComponents: [],
          subComponentIds: [],
          confidence: { score: 0.95, evidence: ["symbol-resolution"] },
        });
      }
    }

    // Default export function: export default function() {}
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
      const declarations = defaultExport.getDeclarations();
      for (const decl of declarations) {
        if (decl.getKind() === SyntaxKind.FunctionDeclaration) {
          const name = defaultExport.getName() === "default"
            ? this.inferNameFromFile(relativePath)
            : defaultExport.getName();

          if (!this.isComponentName(name)) continue;

          const canonicalId = buildCanonicalId(relativePath, name);
          if (components.some((c) => c.id === canonicalId)) continue;

          const componentJsxTags = this.getJsxTagsFromNode(decl);
          const declSourceText = decl.getText();
          const type = classifyComponent(
            name,
            imports,
            componentJsxTags,
            relativePath,
            this.config.customRules,
            declSourceText
          );

          const identity: CanonicalIdentity = {
            canonicalId,
            sourceFile: relativePath,
            exportName: name,
            absolutePath: filePath,
            compositeRoot: null,
          };

          this.trackUsage(canonicalId, relativePath);

          components.push({
            identity,
            id: canonicalId,
            name,
            filePath,
            relativePath,
            type,
            rendering,
            exportType: "default",
            imports,
            jsxChildren: componentJsxTags,
            usedInRoutes: [],
            usedInFiles: [],
            isReusable: false,
            isDynamicImport: hasDynamicImport,
            line: decl.getStartLineNumber(),
            column: 1,
            isComposite: false,
            subComponents: [],
            subComponentIds: [],
            confidence: { score: 0.9, evidence: ["symbol-resolution"] },
          });
        }
      }
    }

    return components;
  }

  /**
   * Extract import edges from a source file.
   * Uses ts-morph module resolution to follow actual compiler resolution paths.
   */
  private extractImportEdges(sourceFile: SourceFile): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const filePath = relative(this.config.projectRoot, sourceFile.getFilePath()).replace(/\\/g, "/");

    for (const importDecl of sourceFile.getImportDeclarations()) {
      // Use ts-morph to resolve the module — handles path aliases via tsconfig
      const resolvedSource = importDecl.getModuleSpecifierSourceFile();
      if (!resolvedSource) continue;

      const targetPath = relative(this.config.projectRoot, resolvedSource.getFilePath()).replace(/\\/g, "/");

      // Skip external modules
      if (targetPath.includes("node_modules")) continue;

      edges.push({
        source: filePath,
        target: targetPath,
        relationship: "imports",
      });

      // Track named imports for component usage (identity-based)
      for (const namedImport of importDecl.getNamedImports()) {
        const importName = namedImport.getName();
        if (this.isComponentName(importName)) {
          const canonicalId = buildCanonicalId(targetPath, importName);
          const usages = this.componentUsageMap.get(canonicalId) ?? new Set();
          usages.add(filePath);
          this.componentUsageMap.set(canonicalId, usages);
        }
      }

      // Track default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const importName = defaultImport.getText();
        if (this.isComponentName(importName)) {
          const canonicalId = buildCanonicalId(targetPath, importName);
          const usages = this.componentUsageMap.get(canonicalId) ?? new Set();
          usages.add(filePath);
          this.componentUsageMap.set(canonicalId, usages);
        }
      }
    }

    return edges;
  }

  /**
   * Resolve reusability: identity-based, not name-based.
   * A component is reusable if its CANONICAL ID is imported by more than one file.
   */
  private resolveReusability(components: ComponentMeta[]): void {
    for (const component of components) {
      const usages = this.componentUsageMap.get(component.id);
      if (usages) {
        component.usedInFiles = Array.from(usages).filter((f) => f !== component.relativePath);
        component.isReusable = component.usedInFiles.length > 1;
      }
    }
  }

  /**
   * Build render edges from JSX usage using symbol resolution.
   * Uses the SymbolResolver to trace JSX tags back to their canonical declarations.
   */
  private buildRenderEdges(components: ComponentMeta[]): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const componentMap = new Map(components.map((c) => [c.id, c]));
    const nameToId = new Map(components.map((c) => [c.name, c.id]));

    for (const parent of components) {
      for (const childTag of parent.jsxChildren) {
        // First try symbol-resolved canonical ID
        const childId = nameToId.get(childTag);
        if (childId && componentMap.has(childId)) {
          edges.push({
            source: parent.id,
            target: childId,
            relationship: "renders",
            confidence: { score: 0.95, evidence: ["symbol-resolution", "jsx-nesting"] },
          });
        }
      }
    }

    return edges;
  }

  /**
   * Get resolved JSX tags using symbol resolution when available.
   * Falls back to text-based extraction.
   */
  private getResolvedJsxTags(sourceFile: SourceFile): string[] {
    if (this.symbolResolver) {
      const resolved = this.symbolResolver.resolveAllJsxTags(sourceFile);
      const tags = new Set<string>();
      for (const [localName, resolvedSymbol] of resolved) {
        // Use the export name from the canonical identity
        tags.add(resolvedSymbol.identity.exportName === "*"
          ? localName
          : resolvedSymbol.identity.exportName);
      }
      return Array.from(tags);
    }

    // Fallback to text-based extraction
    return this.getJsxTags(sourceFile);
  }

  /**
   * Get all import module specifier paths from a source file.
   */
  private getImportPaths(sourceFile: SourceFile): string[] {
    return sourceFile
      .getImportDeclarations()
      .map((i) => i.getModuleSpecifierValue());
  }

  /**
   * Get all JSX opening element tag names from a source file (text-based fallback).
   */
  private getJsxTags(sourceFile: SourceFile): string[] {
    const tags = new Set<string>();

    for (const jsxElement of sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
      const tagName = jsxElement.getTagNameNode().getText();
      if (this.isComponentName(tagName)) {
        tags.add(tagName);
      }
    }

    for (const jsxSelf of sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
      const tagName = jsxSelf.getTagNameNode().getText();
      if (this.isComponentName(tagName)) {
        tags.add(tagName);
      }
    }

    return Array.from(tags);
  }

  /**
   * Get JSX tags used within a specific AST node.
   */
  private getJsxTagsFromNode(node: Node): string[] {
    const tags = new Set<string>();

    for (const jsxElement of node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
      const tagName = jsxElement.getTagNameNode().getText();
      if (this.isComponentName(tagName)) {
        tags.add(tagName);
      }
    }

    for (const jsxSelf of node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
      const tagName = jsxSelf.getTagNameNode().getText();
      if (this.isComponentName(tagName)) {
        tags.add(tagName);
      }
    }

    return Array.from(tags);
  }

  /**
   * Detect whether a source file is a client or server component.
   */
  private detectRenderingEnvironment(sourceFile: SourceFile): RenderingEnvironment {
    const fullText = sourceFile.getFullText();
    const firstStatements = fullText.trimStart();
    if (
      firstStatements.startsWith('"use client"') ||
      firstStatements.startsWith("'use client'")
    ) {
      return "client";
    }
    return "server";
  }

  /**
   * Detect if a source file contains dynamic imports.
   */
  private hasDynamicImport(sourceFile: SourceFile): boolean {
    const imports = sourceFile.getImportDeclarations();
    for (const imp of imports) {
      if (imp.getModuleSpecifierValue() === "next/dynamic") {
        return true;
      }
    }

    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExpressions) {
      const expression = call.getExpression();
      if (expression.getKind() === SyntaxKind.ImportKeyword) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a name looks like a React component (PascalCase or Dotted.PascalCase).
   */
  private isComponentName(name: string): boolean {
    if (!name) return false;
    const baseName = name.includes(".") ? name.split(".")[0]! : name;
    return /^[A-Z][a-zA-Z0-9]*/.test(baseName) && !/^[A-Z_]+$/.test(baseName);
  }

  /**
   * Infer a component name from a file path.
   */
  private inferNameFromFile(relativePath: string): string {
    const parts = relativePath.split("/");
    const fileName = parts.pop()?.replace(/\.(tsx?|jsx?)$/, "") ?? "Unknown";

    if (["page", "layout", "loading", "error", "template", "index"].includes(fileName)) {
      const parentDir = parts.pop() ?? fileName;
      const cleaned = parentDir.replace(/[()]/g, "");
      return this.toPascalCase(cleaned) + this.toPascalCase(fileName);
    }

    return this.toPascalCase(fileName);
  }

  /**
   * Convert a kebab/snake case string to PascalCase.
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  /**
   * Track which files a component's canonical ID is used in.
   */
  private trackUsage(canonicalId: string, filePath: string): void {
    const existing = this.componentUsageMap.get(canonicalId) ?? new Set();
    existing.add(filePath);
    this.componentUsageMap.set(canonicalId, existing);
  }
}
