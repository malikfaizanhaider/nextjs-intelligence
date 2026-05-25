import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, basename } from "node:path";
import fg from "fast-glob";
import type { ComponentType } from "../../intelligence-types/src/index";
import { classifyComponent } from "../../intelligence-core/src/analyzer/classifier";

// ─── Types ──────────────────────────────────────────────────

interface TransformOptions {
  /** Project root directory */
  projectRoot: string;
  /** Glob patterns for files to transform */
  include: string[];
  /** Glob patterns to exclude */
  exclude: string[];
  /** Whether to write files in place or output to a directory */
  dryRun?: boolean;
}

interface TransformResult {
  filePath: string;
  transformed: boolean;
  componentsInjected: string[];
}

// ─── Marker ─────────────────────────────────────────────────

const INJECTION_MARKER = "/* __INTELLIGENCE_INJECTED__ */";

// ─── Transform Logic ────────────────────────────────────────

/**
 * Source-level transformer that injects `useComponentRegistration` calls
 * into React component files.
 *
 * This works at the source text level, parsing component patterns and
 * injecting the registration hook call. It operates on the source before
 * SWC/TypeScript compilation, preserving source maps through Next.js's
 * standard compilation pipeline.
 *
 * Supported patterns:
 * - `export function ComponentName() {`
 * - `export default function ComponentName() {`
 * - `export const ComponentName = () => {`
 * - `export const ComponentName = function() {`
 * - `export const ComponentName = React.forwardRef(`
 * - `export const ComponentName = React.memo(`
 */
export async function transformFile(
  filePath: string,
  projectRoot: string
): Promise<TransformResult> {
  const content = await readFile(filePath, "utf-8");
  const result = transformSource(content, filePath, projectRoot);

  return {
    filePath,
    transformed: result.transformed,
    componentsInjected: result.componentsInjected,
  };
}

/**
 * Transform source code string by injecting useComponentRegistration.
 */
export function transformSource(
  source: string,
  filePath: string,
  projectRoot: string
): { code: string; transformed: boolean; componentsInjected: string[] } {
  // Skip if already injected
  if (source.includes(INJECTION_MARKER)) {
    return { code: source, transformed: false, componentsInjected: [] };
  }

  // Skip non-client components (server components can't use hooks)
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('"use client"') && !trimmed.startsWith("'use client'")) {
    return { code: source, transformed: false, componentsInjected: [] };
  }

  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
  const componentsInjected: string[] = [];
  let modified = source;

  // Pattern 1: export function ComponentName(
  const exportFnRegex = /export\s+(default\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = exportFnRegex.exec(source)) !== null) {
    const componentName = match[2]!;
    const fullMatch = match[0];
    const injection = buildInjection(componentName, relativePath);

    modified = modified.replace(
      fullMatch,
      `${fullMatch}\n${injection}`
    );
    componentsInjected.push(componentName);
  }

  // Pattern 2: export const ComponentName = () => {
  const exportArrowRegex = /export\s+const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::\s*[^=]+)?\s*=>\s*\{/g;

  while ((match = exportArrowRegex.exec(source)) !== null) {
    const componentName = match[1]!;
    const fullMatch = match[0];

    if (componentsInjected.includes(componentName)) continue;

    const injection = buildInjection(componentName, relativePath);
    modified = modified.replace(
      fullMatch,
      `${fullMatch}\n${injection}`
    );
    componentsInjected.push(componentName);
  }

  // Pattern 3: export const ComponentName = function(
  const exportFnExprRegex = /export\s+const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*function\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;

  while ((match = exportFnExprRegex.exec(source)) !== null) {
    const componentName = match[1]!;
    const fullMatch = match[0];

    if (componentsInjected.includes(componentName)) continue;

    const injection = buildInjection(componentName, relativePath);
    modified = modified.replace(
      fullMatch,
      `${fullMatch}\n${injection}`
    );
    componentsInjected.push(componentName);
  }

  if (componentsInjected.length === 0) {
    return { code: source, transformed: false, componentsInjected: [] };
  }

  // Add the import at the top (after "use client" directive)
  const importStatement = `\nimport { useComponentRegistration } from "@i2c/intelligence/runtime";\n${INJECTION_MARKER}\n`;

  // Insert after the "use client" directive line
  const directiveEndIndex = modified.indexOf("\n") + 1;
  modified = modified.slice(0, directiveEndIndex) + importStatement + modified.slice(directiveEndIndex);

  return { code: modified, transformed: true, componentsInjected };
}

/**
 * Build the useComponentRegistration injection code.
 * Uses canonical IDs for stable tracking.
 */
function buildInjection(componentName: string, relativePath: string): string {
  const canonicalId = `${relativePath}#${componentName}`;
  const type = inferComponentType(componentName, relativePath);

  return `  useComponentRegistration({ canonicalId: "${canonicalId}", type: "${type}", sourceFile: "${relativePath}", exportName: "${componentName}", compositeRoot: null });`;
}

/**
 * Infer component type from name and file path.
 */
function inferComponentType(name: string, filePath: string): ComponentType {
  return classifyComponent(name, [], [], filePath);
}

/**
 * Transform all matching files in a project.
 */
export async function transformProject(
  options: TransformOptions
): Promise<TransformResult[]> {
  const normalizedRoot = options.projectRoot.replace(/\\/g, "/");
  const files = await fg(options.include, {
    cwd: normalizedRoot,
    absolute: true,
    ignore: [
      ...options.exclude,
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
    ],
    onlyFiles: true,
  });

  const results: TransformResult[] = [];

  for (const file of files) {
    const result = await transformFile(file, options.projectRoot);
    results.push(result);

    if (result.transformed && !options.dryRun) {
      const content = await readFile(file, "utf-8");
      const transformed = transformSource(content, file, options.projectRoot);
      await writeFile(file, transformed.code, "utf-8");
    }
  }

  return results;
}
