import { SyntaxKind, type SourceFile, type Project } from "ts-morph";
import { relative } from "node:path";
import type { SearchParamUsage } from "../@i2c/intelligence-types";

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
 * Analyzes source files for searchParams, useSearchParams(), and dynamic params usage.
 * Detects:
 *   - searchParams.page, searchParams.tab, etc. (server component props)
 *   - const sp = useSearchParams(); sp.get("page")
 *   - params.id, params.slug (dynamic route params)
 *   - useParams() hook usage
 */
export class SearchParamsAnalyzer {
  private project: Project;
  private projectRoot: string;

  constructor(project: Project, projectRoot: string) {
    this.project = project;
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze a set of files for search params and dynamic params usage.
   */
  analyzeFiles(filePaths: string[]): SearchParamsResult {
    const searchParams = new Map<string, SearchParamUsage>();
    const dynamicParams = new Set<string>();

    for (const filePath of filePaths) {
      const sourceFile = this.project.getSourceFile(filePath.replace(/\\/g, "/"));
      if (!sourceFile) continue;

      const relPath = relative(this.projectRoot, filePath).replace(/\\/g, "/");
      const componentName = this.inferComponentName(relPath);

      this.detectServerSearchParams(sourceFile, componentName, searchParams);
      this.detectUseSearchParams(sourceFile, componentName, searchParams);
      this.detectDynamicParams(sourceFile, componentName, dynamicParams);
      this.detectUseParams(sourceFile, componentName, dynamicParams);
    }

    return { searchParams, dynamicParams: Array.from(dynamicParams) };
  }

  /**
   * Detect searchParams.xxx access in server component function signatures.
   * Pattern: function Page({ searchParams }: { searchParams: ... })
   * Then: searchParams.page, searchParams.tab, searchParams["filter"]
   */
  private detectServerSearchParams(
    sourceFile: SourceFile,
    componentName: string,
    result: Map<string, SearchParamUsage>
  ): void {
    const fullText = sourceFile.getFullText();

    // Match searchParams.xxx property access
    const dotAccessRegex = /searchParams\s*\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let match: RegExpExecArray | null;

    while ((match = dotAccessRegex.exec(fullText)) !== null) {
      const param = match[1]!;
      if (this.isValidParamName(param)) {
        this.addSearchParam(result, param, componentName, "searchParams");
      }
    }

    // Match searchParams["xxx"] or searchParams['xxx'] bracket access
    const bracketAccessRegex = /searchParams\s*\[\s*["']([^"']+)["']\s*\]/g;
    while ((match = bracketAccessRegex.exec(fullText)) !== null) {
      const param = match[1]!;
      this.addSearchParam(result, param, componentName, "searchParams");
    }

    // Match destructuring: const { page, tab } = searchParams
    const destructureRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?searchParams/g;
    while ((match = destructureRegex.exec(fullText)) !== null) {
      const destructured = match[1]!;
      const params = destructured.split(",").map((p) => p.trim().split(":")[0]!.split("=")[0]!.trim());
      for (const param of params) {
        if (param && this.isValidParamName(param)) {
          this.addSearchParam(result, param, componentName, "searchParams");
        }
      }
    }
  }

  /**
   * Detect useSearchParams() hook usage.
   * Pattern: const searchParams = useSearchParams()
   * Then: searchParams.get("page"), searchParams.getAll("tags")
   */
  private detectUseSearchParams(
    sourceFile: SourceFile,
    componentName: string,
    result: Map<string, SearchParamUsage>
  ): void {
    const fullText = sourceFile.getFullText();

    // Check if useSearchParams is used
    if (!fullText.includes("useSearchParams")) return;

    // Find the variable name assigned from useSearchParams()
    const assignmentRegex = /(?:const|let|var)\s+(\w+)\s*=\s*useSearchParams\s*\(\s*\)/g;
    let match: RegExpExecArray | null;
    const varNames: string[] = [];

    while ((match = assignmentRegex.exec(fullText)) !== null) {
      varNames.push(match[1]!);
    }

    // For each variable, find .get("xxx"), .getAll("xxx"), .has("xxx")
    for (const varName of varNames) {
      const getRegex = new RegExp(
        `${this.escapeRegex(varName)}\\.(?:get|getAll|has)\\s*\\(\\s*["']([^"']+)["']\\s*\\)`,
        "g"
      );
      while ((match = getRegex.exec(fullText)) !== null) {
        this.addSearchParam(result, match[1]!, componentName, "useSearchParams");
      }
    }

    // Also check for URLSearchParams iteration patterns
    // searchParams.entries(), searchParams.keys(), etc. — record as generic usage
  }

  /**
   * Detect dynamic route params usage.
   * Pattern: params.id, params.slug — from function props.
   */
  private detectDynamicParams(
    sourceFile: SourceFile,
    _componentName: string,
    result: Set<string>
  ): void {
    const fullText = sourceFile.getFullText();

    // Match params.xxx property access
    const dotAccessRegex = /params\s*\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let match: RegExpExecArray | null;

    while ((match = dotAccessRegex.exec(fullText)) !== null) {
      const param = match[1]!;
      if (this.isValidParamName(param)) {
        result.add(param);
      }
    }

    // Match destructuring: const { id, slug } = params
    const destructureRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?params/g;
    while ((match = destructureRegex.exec(fullText)) !== null) {
      const destructured = match[1]!;
      const params = destructured.split(",").map((p) => p.trim().split(":")[0]!.split("=")[0]!.trim());
      for (const param of params) {
        if (param && this.isValidParamName(param)) {
          result.add(param);
        }
      }
    }
  }

  /**
   * Detect useParams() hook usage.
   */
  private detectUseParams(
    sourceFile: SourceFile,
    _componentName: string,
    result: Set<string>
  ): void {
    const fullText = sourceFile.getFullText();
    if (!fullText.includes("useParams")) return;

    // Find variable assigned from useParams()
    const assignmentRegex = /(?:const|let|var)\s+(\w+)\s*=\s*useParams\s*\(\s*\)/g;
    let match: RegExpExecArray | null;
    const varNames: string[] = [];

    while ((match = assignmentRegex.exec(fullText)) !== null) {
      varNames.push(match[1]!);
    }

    // Find property access on those variables
    for (const varName of varNames) {
      const accessRegex = new RegExp(
        `${this.escapeRegex(varName)}\\.([a-zA-Z_$][a-zA-Z0-9_$]*)`,
        "g"
      );
      while ((match = accessRegex.exec(fullText)) !== null) {
        const param = match[1]!;
        if (this.isValidParamName(param)) {
          result.add(param);
        }
      }

      // Also destructured: const { id } = useParams()
      const destructureRegex = new RegExp(
        `(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*useParams\\s*\\(`,
        "g"
      );
      while ((match = destructureRegex.exec(fullText)) !== null) {
        const destructured = match[1]!;
        const params = destructured.split(",").map((p) => p.trim().split(":")[0]!.split("=")[0]!.trim());
        for (const param of params) {
          if (param && this.isValidParamName(param)) {
            result.add(param);
          }
        }
      }
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
      result.set(param, {
        param,
        usedIn: [componentName],
        accessPattern,
      });
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
    // Exclude common JS properties and methods
    const excluded = new Set([
      "then", "catch", "finally", "toString", "valueOf", "constructor",
      "prototype", "length", "name", "apply", "call", "bind",
    ]);
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !excluded.has(name);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
