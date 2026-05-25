import { resolve, relative, posix } from "node:path";
import type { RouteMeta } from "../../../intelligence-types/src/index";
import fg from "fast-glob";

const NEXT_SPECIAL_FILES = ["page", "layout", "loading", "error", "template"] as const;

/**
 * Detect all Next.js App Router routes by scanning for page.tsx files
 * and associating related layout/loading/error/template files.
 */
export async function detectRoutes(projectRoot: string, appDir: string): Promise<RouteMeta[]> {
  const absoluteAppDir = resolve(projectRoot, appDir);
  const normalizedAppDir = absoluteAppDir.replace(/\\/g, "/");

  // Find all page.tsx/page.ts/page.jsx/page.js files
  const pageFiles = await fg("**/page.{tsx,ts,jsx,js}", {
    cwd: normalizedAppDir,
    absolute: false,
    onlyFiles: true,
    ignore: ["node_modules/**", ".next/**"],
  });

  const routes: RouteMeta[] = [];

  for (const pageFile of pageFiles.sort()) {
    const dir = pageFile.replace(/\/page\.(tsx?|jsx?)$/, "") || ".";
    const routePath = buildRoutePath(dir);

    const absolutePagePath = resolve(absoluteAppDir, pageFile);
    const relativePath = relative(projectRoot, absolutePagePath).replace(/\\/g, "/");

    // Detect associated special files
    const layoutFile = await findSpecialFile(normalizedAppDir, dir, "layout");
    const loadingFile = await findSpecialFile(normalizedAppDir, dir, "loading");
    const errorFile = await findSpecialFile(normalizedAppDir, dir, "error");
    const templateFile = await findSpecialFile(normalizedAppDir, dir, "template");

    const segmentType = detectSegmentType(routePath);
    const parentRoute = getParentRoute(routePath);
    const isRouteGroup = dir.includes("(") && dir.includes(")");

    routes.push({
      path: routePath,
      filePath: absolutePagePath,
      relativePath,
      segmentType,
      layoutFilePath: layoutFile,
      loadingFilePath: loadingFile,
      errorFilePath: errorFile,
      templateFilePath: templateFile,
      components: [],
      isRouteGroup,
      parentRoute,
    });
  }

  return routes;
}

/**
 * Build a URL path from a filesystem directory structure.
 * Handles route groups, dynamic segments, catch-all, etc.
 */
function buildRoutePath(dir: string): string {
  if (dir === ".") return "/";

  const segments = dir.split("/").filter(Boolean);
  const pathSegments: string[] = [];

  for (const segment of segments) {
    // Route groups: (groupName) — skip in URL
    if (/^\(.*\)$/.test(segment)) {
      continue;
    }
    // Parallel routes: @slot — skip in URL
    if (segment.startsWith("@")) {
      continue;
    }
    // Intercepting routes: (.) (..) (...) — keep but normalize
    if (/^\(\.\.*\)/.test(segment)) {
      pathSegments.push(segment);
      continue;
    }
    pathSegments.push(segment);
  }

  const path = "/" + pathSegments.join("/");
  return path || "/";
}

/**
 * Detect segment type from route path.
 */
function detectSegmentType(routePath: string): RouteMeta["segmentType"] {
  if (routePath.includes("[...") && routePath.includes("]")) {
    if (routePath.includes("[[...")) {
      return "optional-catch-all";
    }
    return "catch-all";
  }
  if (routePath.includes("[") && routePath.includes("]")) {
    return "dynamic";
  }
  if (routePath.includes("@")) {
    return "parallel";
  }
  if (routePath.includes("(.)") || routePath.includes("(..)")) {
    return "intercepting";
  }
  return "static";
}

/**
 * Get parent route path.
 */
function getParentRoute(routePath: string): string | null {
  if (routePath === "/") return null;
  const segments = routePath.split("/").filter(Boolean);
  segments.pop();
  return segments.length === 0 ? "/" : "/" + segments.join("/");
}

/**
 * Find a special Next.js file (layout, loading, error, template) in a directory.
 */
async function findSpecialFile(
  appDir: string,
  dir: string,
  fileName: (typeof NEXT_SPECIAL_FILES)[number]
): Promise<string | null> {
  const pattern = dir === "."
    ? `${fileName}.{tsx,ts,jsx,js}`
    : `${dir}/${fileName}.{tsx,ts,jsx,js}`;

  const matches = await fg(pattern, {
    cwd: appDir,
    absolute: true,
    onlyFiles: true,
  });

  return matches.length > 0 ? matches[0]! : null;
}
