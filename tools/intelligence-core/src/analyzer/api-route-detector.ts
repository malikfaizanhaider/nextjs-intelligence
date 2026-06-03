import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import fg from "fast-glob";
import type {
  ApiRoute,
  ApiRouteMethod,
  MiddlewareMeta,
  RouteMeta,
} from "../../../intelligence-types/src/index";

const ALL_HTTP_METHODS: readonly ApiRouteMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/**
 * Detect Next.js Route Handlers (`route.{ts,tsx,js,jsx}`) under the given
 * app directories. Returned routes are sorted by `path` for determinism.
 *
 * We deliberately use cheap regex extraction over the file source instead of a
 * full ts-morph traversal — Route Handlers are tiny by convention and we only
 * need to know which HTTP method names are exported.
 */
export async function detectApiRoutes(
  projectRoot: string,
  appDirs: string | string[]
): Promise<ApiRoute[]> {
  const dirs = Array.isArray(appDirs) ? appDirs : [appDirs];
  const seen = new Map<string, ApiRoute>();

  for (const appDir of dirs) {
    const absoluteAppDir = resolve(projectRoot, appDir).replace(/\\/g, "/");
    const handlerFiles = await fg("**/route.{ts,tsx,js,jsx}", {
      cwd: absoluteAppDir,
      absolute: false,
      onlyFiles: true,
      ignore: ["node_modules/**", ".next/**"],
    });

    for (const handlerFile of handlerFiles.sort()) {
      const dir = dirname(handlerFile).replace(/\\/g, "/");
      const routePath = buildRoutePath(dir);
      const absolutePath = resolve(absoluteAppDir, handlerFile);
      const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, "/");

      const source = await readFileSafe(absolutePath);
      const methods = extractExportedMethods(source);

      seen.set(routePath, {
        path: routePath,
        filePath: absolutePath,
        relativePath,
        methods,
        segmentType: detectSegmentType(routePath),
        isDynamic: routePath.includes("["),
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Detect the project's middleware file. Next.js allows exactly one of
 * `middleware.{ts,tsx,js,jsx}` at the project root or under `src/`.
 */
export async function detectMiddleware(
  projectRoot: string
): Promise<MiddlewareMeta[]> {
  const normalizedRoot = projectRoot.replace(/\\/g, "/");
  const candidates = await fg(
    [
      "middleware.{ts,tsx,js,jsx}",
      "src/middleware.{ts,tsx,js,jsx}",
    ],
    {
      cwd: normalizedRoot,
      absolute: true,
      onlyFiles: true,
      ignore: ["node_modules/**", ".next/**"],
    }
  );

  const results: MiddlewareMeta[] = [];
  for (const filePath of candidates.sort()) {
    const source = await readFileSafe(filePath);
    results.push({
      filePath,
      relativePath: relative(projectRoot, filePath).replace(/\\/g, "/"),
      hasDefaultExport: /export\s+default\s+/.test(source),
      matcher: extractMatcherConfig(source),
    });
  }
  return results;
}

// ── Internals ────────────────────────────────────────────────

function buildRoutePath(dir: string): string {
  if (dir === ".") return "/";
  const segments = dir.split("/").filter(Boolean);
  const pathSegments: string[] = [];
  for (const segment of segments) {
    if (/^\(.*\)$/.test(segment)) continue; // route group
    if (segment.startsWith("@")) continue; // parallel slot
    pathSegments.push(segment);
  }
  return "/" + pathSegments.join("/");
}

function detectSegmentType(routePath: string): RouteMeta["segmentType"] {
  if (routePath.includes("[[...")) return "optional-catch-all";
  if (routePath.includes("[...")) return "catch-all";
  if (routePath.includes("[")) return "dynamic";
  return "static";
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract the names of HTTP method exports from a Route Handler source string.
 * Matches:
 *   export function GET() {}
 *   export async function POST() {}
 *   export const PUT = ...
 *   export { GET, POST } from "..."
 */
function extractExportedMethods(source: string): ApiRouteMethod[] {
  const found = new Set<ApiRouteMethod>();

  for (const method of ALL_HTTP_METHODS) {
    const patterns = [
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s+let\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ];
    if (patterns.some((p) => p.test(source))) {
      found.add(method);
    }
  }

  return Array.from(found).sort() as ApiRouteMethod[];
}

/**
 * Extract literal string matcher entries from
 *   `export const config = { matcher: ["..."] };`
 * Returns `null` when no matcher could be statically resolved.
 */
function extractMatcherConfig(source: string): string[] | null {
  const configMatch = source.match(
    /export\s+const\s+config\s*(?::\s*[^=]+)?=\s*\{([\s\S]*?)\}\s*;?/
  );
  if (!configMatch) return null;
  const body = configMatch[1] ?? "";

  // Array form: matcher: ["/a", "/b"]
  const arrayMatch = body.match(/matcher\s*:\s*\[([\s\S]*?)\]/);
  if (arrayMatch) {
    const items = Array.from(
      (arrayMatch[1] ?? "").matchAll(/['"`]([^'"`]+)['"`]/g)
    ).map((m) => m[1]!);
    return items.length > 0 ? items : null;
  }

  // String form: matcher: "/path"
  const stringMatch = body.match(/matcher\s*:\s*['"`]([^'"`]+)['"`]/);
  if (stringMatch) return [stringMatch[1]!];

  return null;
}
