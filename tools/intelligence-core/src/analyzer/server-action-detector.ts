import { relative } from "node:path";
import { SyntaxKind, type Project, type SourceFile, type Node } from "ts-morph";
import type { ServerActionMeta } from "../../../intelligence-types/src/index";
import { buildCanonicalId } from "../../../intelligence-types/src/index";

const USE_SERVER_DIRECTIVES = new Set(['"use server"', "'use server'"]);

/**
 * Detect Next.js Server Actions via the `"use server"` directive.
 *
 * Two scopes per the React Server Components spec:
 *   - **module**: the directive is the first statement in the file, so every
 *     exported async function in the module is an action.
 *   - **function**: the directive is the first statement *inside* a specific
 *     async function declaration.
 *
 * Returns one {@link ServerActionMeta} per discovered action, sorted by
 * `canonicalId` for deterministic output.
 */
export class ServerActionDetector {
  private actions: ServerActionMeta[] = [];

  constructor(private project: Project, private projectRoot: string) {}

  detect(): ServerActionMeta[] {
    this.actions = [];

    for (const sourceFile of this.project.getSourceFiles()) {
      this.scanFile(sourceFile);
    }

    return this.actions
      .slice()
      .sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
  }

  /** Source files (relative paths) that contain at least one server action. */
  getFilesWithActions(): Set<string> {
    return new Set(this.actions.map((a) => a.relativePath));
  }

  private scanFile(sourceFile: SourceFile): void {
    const filePath = sourceFile.getFilePath();
    const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, "/");

    if (this.hasFileLevelDirective(sourceFile)) {
      this.recordModuleDirective(sourceFile, relativePath);
      // File-level "use server" makes every exported function an action,
      // but we still iterate to record each named export for the manifest.
      for (const fn of this.collectExportedAsyncFunctions(sourceFile)) {
        this.actions.push({
          canonicalId: buildCanonicalId(relativePath, fn.name),
          relativePath,
          exportName: fn.name,
          scope: "module",
          line: fn.line,
        });
      }
      return;
    }

    // Otherwise look for per-function `"use server"` directives.
    for (const fn of this.collectExportedAsyncFunctions(sourceFile)) {
      if (fn.hasFunctionLevelDirective) {
        this.actions.push({
          canonicalId: buildCanonicalId(relativePath, fn.name),
          relativePath,
          exportName: fn.name,
          scope: "function",
          line: fn.directiveLine ?? fn.line,
        });
      }
    }
  }

  private recordModuleDirective(
    sourceFile: SourceFile,
    relativePath: string
  ): void {
    const statements = sourceFile.getStatements();
    const directiveLine = statements[0]?.getStartLineNumber() ?? 1;
    this.actions.push({
      canonicalId: buildCanonicalId(relativePath, "__module__"),
      relativePath,
      exportName: "__module__",
      scope: "module",
      line: directiveLine,
    });
  }

  private hasFileLevelDirective(sourceFile: SourceFile): boolean {
    const statements = sourceFile.getStatements();
    if (statements.length === 0) return false;
    const first = statements[0]!;
    if (first.getKind() !== SyntaxKind.ExpressionStatement) return false;
    return USE_SERVER_DIRECTIVES.has(first.getText().replace(/;\s*$/, ""));
  }

  private collectExportedAsyncFunctions(
    sourceFile: SourceFile
  ): Array<{
    name: string;
    line: number;
    hasFunctionLevelDirective: boolean;
    directiveLine: number | null;
  }> {
    const results: Array<{
      name: string;
      line: number;
      hasFunctionLevelDirective: boolean;
      directiveLine: number | null;
    }> = [];

    // function declarations
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name || !fn.isExported() || !fn.isAsync()) continue;
      const directiveLine = this.findInnerDirectiveLine(fn);
      results.push({
        name,
        line: fn.getStartLineNumber(),
        hasFunctionLevelDirective: directiveLine !== null,
        directiveLine,
      });
    }

    // variable-declared arrow/function expressions
    for (const varStmt of sourceFile.getVariableStatements()) {
      if (!varStmt.isExported()) continue;
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        const init = decl.getInitializer();
        if (!init) continue;
        const kind = init.getKind();
        if (
          kind !== SyntaxKind.ArrowFunction &&
          kind !== SyntaxKind.FunctionExpression
        ) {
          continue;
        }
        // Detect async — both ArrowFunction and FunctionExpression expose
        // isAsync() through ts-morph's modifier helpers.
        const isAsync = (init as unknown as { isAsync?: () => boolean }).isAsync?.() ?? false;
        if (!isAsync) continue;
        const directiveLine = this.findInnerDirectiveLine(init);
        results.push({
          name,
          line: decl.getStartLineNumber(),
          hasFunctionLevelDirective: directiveLine !== null,
          directiveLine,
        });
      }
    }

    return results;
  }

  /**
   * Returns the line number of an inner `"use server"` directive if the body
   * begins with one; otherwise `null`.
   */
  private findInnerDirectiveLine(node: Node): number | null {
    const body = (node as unknown as { getBody?: () => Node | undefined }).getBody?.();
    if (!body) return null;
    if (body.getKind() !== SyntaxKind.Block) return null;
    const stmts = (body as unknown as {
      getStatements: () => Node[];
    }).getStatements();
    if (stmts.length === 0) return null;
    const first = stmts[0]!;
    if (first.getKind() !== SyntaxKind.ExpressionStatement) return null;
    const text = first.getText().replace(/;\s*$/, "");
    return USE_SERVER_DIRECTIVES.has(text) ? first.getStartLineNumber() : null;
  }
}
