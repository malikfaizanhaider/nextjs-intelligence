import {
  SyntaxKind,
  type SourceFile,
  type Project,
  type Node,
  type CallExpression,
  type PropertyAccessExpression,
  type ElementAccessExpression,
  type ObjectBindingPattern,
  type VariableDeclaration,
  type ParameterDeclaration,
} from "ts-morph";
import { relative } from "node:path";
import type { SearchParamUsage } from "../../../intelligence-types/src/index";

/**
 * Result of search params analysis for a set of files.
 */
export interface SearchParamsResult {
  /** searchParams.xxx access patterns */
  searchParams: Map<string, SearchParamUsage>;
  /** Dynamic route params ([id], [slug], etc.) */
  dynamicParams: string[];
}

/**
 * AST-based analyzer for searchParams, useSearchParams(), and dynamic params
 * usage. Replaces the original regex implementation so destructuring,
 * conditional access, optional chaining, and identifier shadowing are all
 * tracked correctly.
 *
 * Detection pipeline:
 *  1. Walk every function-like declaration. Bind the parameter name and any
 *     destructured property names for `searchParams` and `params`.
 *  2. Walk variable declarations that bind the result of `useSearchParams()`
 *     or `useParams()`. Capture identifier bindings and object-binding
 *     destructuring.
 *  3. For each bound identifier (file-level), scan the file for
 *     `PropertyAccessExpression`, `ElementAccessExpression`, and
 *     `.get|.getAll|.has(...)` calls.
 */
export class SearchParamsAnalyzer {
  private project: Project;
  private projectRoot: string;

  constructor(project: Project, projectRoot: string) {
    this.project = project;
    this.projectRoot = projectRoot;
  }

  analyzeFiles(filePaths: string[]): SearchParamsResult {
    const searchParams = new Map<string, SearchParamUsage>();
    const dynamicParams = new Set<string>();

    for (const filePath of filePaths) {
      const sourceFile = this.project.getSourceFile(filePath.replace(/\\/g, "/"));
      if (!sourceFile) continue;

      const relPath = relative(this.projectRoot, filePath).replace(/\\/g, "/");
      const componentName = this.inferComponentName(relPath);

      this.analyzeSourceFile(sourceFile, componentName, searchParams, dynamicParams);
    }

    return { searchParams, dynamicParams: Array.from(dynamicParams) };
  }

  private analyzeSourceFile(
    sourceFile: SourceFile,
    componentName: string,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>
  ): void {
    // ── Step 1: collect bindings ────────────────────────────────────────────
    const serverSearchParamsNames = new Set<string>();
    const paramsNames = new Set<string>();
    const useSearchParamsNames = new Set<string>();

    // 1a — function parameter destructuring
    for (const fn of this.getFunctionLikes(sourceFile)) {
      for (const param of fn.getParameters()) {
        this.collectFromParameter(
          param,
          serverSearchParamsNames,
          paramsNames,
          searchParams,
          dynamicParams,
          componentName
        );
      }
    }

    // 1b — variable declarations bound to useSearchParams() / useParams()
    for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      this.collectFromVariableDeclaration(
        decl,
        useSearchParamsNames,
        paramsNames,
        searchParams,
        dynamicParams,
        componentName
      );
    }

    // ── Step 2: scan accesses on bound identifiers ──────────────────────────
    this.scanAccesses(
      sourceFile,
      serverSearchParamsNames,
      useSearchParamsNames,
      paramsNames,
      searchParams,
      dynamicParams,
      componentName
    );
  }

  /**
   * Yields every function-like declaration (function decl, arrow, function
   * expression, class method).
   */
  private *getFunctionLikes(sourceFile: SourceFile): Generator<{
    getParameters: () => ParameterDeclaration[];
  }> {
    for (const fn of sourceFile.getFunctions()) yield fn;
    for (const arrow of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) yield arrow;
    for (const expr of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)) yield expr;
    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) yield method;
    }
  }

  /**
   * Inspect a function parameter. Conventional Next.js page/layout shapes:
   *   - `function Page({ searchParams, params })`
   *   - `function Page({ searchParams: sp })`
   *   - `function Page({ searchParams: { page }, params: { id } })`
   */
  private collectFromParameter(
    param: ParameterDeclaration,
    serverSearchParamsNames: Set<string>,
    paramsNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string
  ): void {
    const nameNode = param.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) return;
    const pattern = nameNode as ObjectBindingPattern;
    for (const element of pattern.getElements()) {
      const propertyName = element.getPropertyNameNode()?.getText() ?? element.getName();
      if (propertyName === "searchParams") {
        this.handleDestructuredKey(
          element,
          serverSearchParamsNames,
          searchParams,
          dynamicParams,
          componentName,
          "searchParams"
        );
      } else if (propertyName === "params") {
        this.handleDestructuredKey(
          element,
          paramsNames,
          searchParams,
          dynamicParams,
          componentName,
          "params"
        );
      }
    }
  }

  private handleDestructuredKey(
    element: import("ts-morph").BindingElement,
    boundNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string,
    kind: "searchParams" | "params"
  ): void {
    const inner = element.getNameNode();
    if (inner.getKind() === SyntaxKind.Identifier) {
      boundNames.add(inner.getText());
      return;
    }
    if (inner.getKind() === SyntaxKind.ObjectBindingPattern) {
      const nested = inner as ObjectBindingPattern;
      for (const sub of nested.getElements()) {
        const subProp = sub.getPropertyNameNode()?.getText() ?? sub.getName();
        if (!this.isValidParamName(subProp)) continue;
        if (kind === "searchParams") {
          this.addSearchParam(searchParams, subProp, componentName, "searchParams");
        } else {
          dynamicParams.add(subProp);
        }
      }
    }
  }

  private collectFromVariableDeclaration(
    decl: VariableDeclaration,
    useSearchParamsNames: Set<string>,
    paramsNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string
  ): void {
    const initializer = decl.getInitializer();
    if (!initializer) return;

    // Unwrap `await ...` for `const x = await searchParams` style.
    const innerInit =
      initializer.getKind() === SyntaxKind.AwaitExpression
        ? (initializer as unknown as { getExpression: () => Node }).getExpression()
        : initializer;

    // Pattern A: destructuring from `searchParams` or `params` identifier
    // e.g. `const { page } = searchParams` (after a server prop binding).
    if (innerInit.getKind() === SyntaxKind.Identifier) {
      const sourceName = innerInit.getText();
      const nameNode = decl.getNameNode();
      if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) return;
      const pattern = nameNode as ObjectBindingPattern;
      // Best-effort: if the source identifier is literally `searchParams` or
      // `params`, treat the destructured keys as such. (Bindings set up by
      // function parameter walk above already covered scoped names.)
      const isSP = sourceName === "searchParams";
      const isPP = sourceName === "params";
      if (!isSP && !isPP) return;
      for (const element of pattern.getElements()) {
        const propName = element.getPropertyNameNode()?.getText() ?? element.getName();
        if (!this.isValidParamName(propName)) continue;
        if (isSP) this.addSearchParam(searchParams, propName, componentName, "searchParams");
        else dynamicParams.add(propName);
      }
      return;
    }

    // Pattern B: call expression — useSearchParams() / useParams()
    if (innerInit.getKind() !== SyntaxKind.CallExpression) return;
    const callee = (innerInit as CallExpression).getExpression().getText();
    let kind: "useSearchParams" | "useParams" | null = null;
    if (callee === "useSearchParams" || callee.endsWith(".useSearchParams")) {
      kind = "useSearchParams";
    } else if (callee === "useParams" || callee.endsWith(".useParams")) {
      kind = "useParams";
    }
    if (!kind) return;

    const nameNode = decl.getNameNode();
    if (nameNode.getKind() === SyntaxKind.Identifier) {
      if (kind === "useSearchParams") useSearchParamsNames.add(nameNode.getText());
      else paramsNames.add(nameNode.getText());
      return;
    }
    if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern) {
      const pattern = nameNode as ObjectBindingPattern;
      for (const element of pattern.getElements()) {
        const propName = element.getPropertyNameNode()?.getText() ?? element.getName();
        if (!this.isValidParamName(propName)) continue;
        if (kind === "useSearchParams") {
          this.addSearchParam(searchParams, propName, componentName, "useSearchParams");
        } else {
          dynamicParams.add(propName);
        }
      }
    }
  }

  /**
   * Scan the file for property/element access and `.get(...)` calls on the
   * bound identifiers. The AST walk visits every descendant regardless of
   * surrounding syntax (ternaries, `?.`, conditionals, etc.).
   */
  private scanAccesses(
    sourceFile: SourceFile,
    serverSearchParamsNames: Set<string>,
    useSearchParamsNames: Set<string>,
    paramsNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string
  ): void {
    const allSearchParamNames = new Set<string>([
      ...serverSearchParamsNames,
      ...useSearchParamsNames,
    ]);

    for (const pa of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      this.handlePropertyAccess(
        pa,
        serverSearchParamsNames,
        useSearchParamsNames,
        paramsNames,
        searchParams,
        dynamicParams,
        componentName
      );
    }

    for (const ea of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      this.handleElementAccess(
        ea,
        allSearchParamNames,
        paramsNames,
        searchParams,
        dynamicParams,
        componentName
      );
    }
  }

  private handlePropertyAccess(
    pa: PropertyAccessExpression,
    serverSearchParamsNames: Set<string>,
    useSearchParamsNames: Set<string>,
    paramsNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string
  ): void {
    const objectName = pa.getExpression().getText();
    const property = pa.getName();

    if (serverSearchParamsNames.has(objectName)) {
      if (this.isValidParamName(property)) {
        this.addSearchParam(searchParams, property, componentName, "searchParams");
      }
      return;
    }

    if (useSearchParamsNames.has(objectName)) {
      // Capture only `.get("x")`, `.getAll("x")`, `.has("x")` call sites.
      if (property !== "get" && property !== "getAll" && property !== "has") return;
      const parent = pa.getParent();
      if (!parent || parent.getKind() !== SyntaxKind.CallExpression) return;
      const args = (parent as CallExpression).getArguments();
      if (args.length === 0) return;
      const firstArg = args[0]!;
      if (firstArg.getKind() !== SyntaxKind.StringLiteral) return;
      const key = (firstArg as unknown as { getLiteralText: () => string }).getLiteralText();
      if (this.isValidParamName(key)) {
        this.addSearchParam(searchParams, key, componentName, "useSearchParams");
      }
      return;
    }

    if (paramsNames.has(objectName) && this.isValidParamName(property)) {
      dynamicParams.add(property);
    }
  }

  private handleElementAccess(
    ea: ElementAccessExpression,
    allSearchParamNames: Set<string>,
    paramsNames: Set<string>,
    searchParams: Map<string, SearchParamUsage>,
    dynamicParams: Set<string>,
    componentName: string
  ): void {
    const objectName = ea.getExpression().getText();
    const arg = ea.getArgumentExpression();
    if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) return;
    const key = (arg as unknown as { getLiteralText: () => string }).getLiteralText();
    if (!this.isValidParamName(key)) return;

    if (allSearchParamNames.has(objectName)) {
      this.addSearchParam(searchParams, key, componentName, "searchParams");
    } else if (paramsNames.has(objectName)) {
      dynamicParams.add(key);
    }
  }

  /**
   * Extract dynamic param names from a route path.
   * e.g., /users/[id]/posts/[postId] → ["id", "postId"]
   */
  static extractParamsFromRoutePath(routePath: string): string[] {
    const params: string[] = [];
    const regex = /\[(?:\.\.\.)?([\w]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(routePath)) !== null) {
      params.push(match[1]!);
    }
    return params;
  }

  private addSearchParam(
    result: Map<string, SearchParamUsage>,
    param: string,
    componentName: string,
    accessPattern: SearchParamUsage["accessPattern"]
  ): void {
    const existing = result.get(param);
    if (existing) {
      if (!existing.usedIn.includes(componentName)) {
        existing.usedIn.push(componentName);
      }
    } else {
      result.set(param, { param, usedIn: [componentName], accessPattern });
    }
  }

  private inferComponentName(relativePath: string): string {
    const parts = relativePath.split("/");
    const fileName = parts.pop()?.replace(/\.(tsx?|jsx?)$/, "") ?? "Unknown";
    if (["page", "layout", "loading", "error", "template", "index"].includes(fileName)) {
      const parentDir = parts.pop() ?? fileName;
      const cleaned = parentDir.replace(/[()]/g, "");
      return this.toPascalCase(cleaned) + this.toPascalCase(fileName);
    }
    return this.toPascalCase(fileName);
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
  }

  private isValidParamName(name: string): boolean {
    // Identifier shape + exclude JS object prototype names that would create
    // noise. URLSearchParams-specific method names (get/getAll/has/sort/...)
    // are filtered separately, only on `useSearchParams()` results, so they
    // do not over-filter legitimate user-defined searchParam keys when a
    // user destructures `{ sort }` from a server `searchParams` prop.
    const excluded = new Set([
      "then", "catch", "finally", "toString", "valueOf", "constructor",
      "prototype", "length", "name", "apply", "call", "bind",
    ]);
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !excluded.has(name);
  }
}

export type { Node };
