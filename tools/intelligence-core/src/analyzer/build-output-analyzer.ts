import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import type { BundleStats, RouteBundleStats } from "../../../intelligence-types/src/index";

/**
 * Per-route rendering / runtime metadata derived from `.next/`.
 *
 * Mirrors the subset of Next.js build manifests that is stable enough to be
 * cross-referenced against static analysis output (rendering mode, runtime,
 * server-action registry, client-boundary registry, etc.).
 */
export interface BuildOutputRouteInfo {
  /** URL path (matches `RouteMeta.path` shape, e.g. `/users/[id]`). */
  path: string;
  /** Rendering strategy inferred from `prerender-manifest` + `routes-manifest`. */
  renderingMode: "static" | "ssg" | "isr" | "dynamic" | "unknown";
  /** ISR revalidate seconds when present in `prerender-manifest`. */
  revalidate: number | null;
  /** Execution runtime when reported by `functions-config-manifest`. */
  runtime: "nodejs" | "edge" | "unknown";
  /** Deployment regions, when declared. */
  regions: string[];
  /** Chunk file paths (relative to `.next/`) attributed to this route. */
  chunks: string[];
  /** Total uncompressed JS bytes for `chunks`. */
  jsBytes: number;
  /** Total uncompressed CSS bytes for `chunks`. */
  cssBytes: number;
}

/**
 * Single entry in the Server Actions registry emitted by Next.js into
 * `.next/server/server-reference-manifest.json`.
 */
export interface BuildOutputServerAction {
  /** Stable action ID (hash) used by the React runtime. */
  id: string;
  /** Workers/files that own the action, when reported. */
  workers: string[];
  /** Source module path, when resolvable. */
  module: string | null;
}

/**
 * Single `"use client"` boundary recorded by Next.js into
 * `.next/server/client-reference-manifest.json`.
 */
export interface BuildOutputClientBoundary {
  /** Reference ID emitted by the Next.js compiler. */
  id: string;
  /** Resolved module path, when available. */
  module: string | null;
  /** Chunks that ship this boundary to the client. */
  chunks: string[];
}

/**
 * Middleware metadata from `.next/server/middleware-manifest.json`.
 */
export interface BuildOutputMiddleware {
  /** Middleware name as reported by Next.js (usually `"middleware"`). */
  name: string;
  /** URL matchers (regex strings or `{ regexp }` entries flattened to strings). */
  matchers: string[];
  /** Runtime — Next.js middleware is `edge` in practice. */
  runtime: "edge" | "nodejs" | "unknown";
}

/**
 * Aggregate result returned by {@link BuildOutputAnalyzer.analyze}.
 *
 * Every field is independently optional so callers can degrade gracefully
 * when a manifest is missing (e.g. older Next.js versions, partial builds).
 */
export interface BuildOutputAnalysis {
  /** Resolved `.next/` directory used for analysis. */
  buildDir: string;
  /** Next.js version reported by `.next/BUILD_ID` siblings, when discoverable. */
  nextVersion: string | null;
  /** Per-route information keyed by URL path. */
  routes: Record<string, BuildOutputRouteInfo>;
  /** Server actions registry. */
  serverActions: BuildOutputServerAction[];
  /** Client component boundaries. */
  clientBoundaries: BuildOutputClientBoundary[];
  /** Middleware entries (zero or one in practice). */
  middleware: BuildOutputMiddleware[];
  /** Manifests that were missing or unreadable, for observability. */
  missingManifests: string[];
}

/**
 * Reads a Next.js `.next/` build output directory and extracts intelligence
 * that complements static AST analysis — bundle sizes, rendering modes,
 * runtime (edge/node), server-action registry, client-boundary registry, and
 * middleware matchers.
 *
 * Pure I/O; does not throw on missing manifests. Unknown / partial inputs
 * surface as `unknown` enums or are recorded in `missingManifests`.
 */
export class BuildOutputAnalyzer {
  constructor(private readonly buildDir: string) {}

  async analyze(): Promise<BuildOutputAnalysis> {
    const missing: string[] = [];

    const [
      appBuildManifest,
      buildManifest,
      routesManifest,
      prerenderManifest,
      appPathsManifest,
      pagesManifest,
      middlewareManifest,
      functionsConfigManifest,
      serverReferenceManifest,
      clientReferenceManifest,
    ] = await Promise.all([
      this.readJson("app-build-manifest.json", missing),
      this.readJson("build-manifest.json", missing),
      this.readJson("routes-manifest.json", missing),
      this.readJson("prerender-manifest.json", missing),
      this.readJson("server/app-paths-manifest.json", missing),
      this.readJson("server/pages-manifest.json", missing),
      this.readJson("server/middleware-manifest.json", missing),
      this.readJson("server/functions-config-manifest.json", missing),
      this.readJson("server/server-reference-manifest.json", missing),
      this.readJson("server/client-reference-manifest.json", missing),
    ]);

    const nextVersion = await this.readNextVersion();

    const routes = await this.buildRoutes({
      appBuildManifest,
      buildManifest,
      routesManifest,
      prerenderManifest,
      appPathsManifest,
      pagesManifest,
      functionsConfigManifest,
    });

    return {
      buildDir: this.buildDir,
      nextVersion,
      routes,
      serverActions: this.extractServerActions(serverReferenceManifest),
      clientBoundaries: this.extractClientBoundaries(clientReferenceManifest),
      middleware: this.extractMiddleware(middlewareManifest),
      missingManifests: missing,
    };
  }

  /**
   * Project a {@link BuildOutputAnalysis} into the {@link BundleStats}
   * shape consumed by `deriveMetrics()`. Returns `null` when no route has
   * any chunks attributed (i.e. nothing meaningful to merge).
   */
  toBundleStats(analysis: BuildOutputAnalysis): BundleStats | null {
    const routes: Record<string, RouteBundleStats> = {};
    let totalJsBytes = 0;
    let totalCssBytes = 0;
    let anyChunks = false;

    for (const info of Object.values(analysis.routes)) {
      if (info.chunks.length === 0 && info.jsBytes === 0 && info.cssBytes === 0) {
        continue;
      }
      anyChunks = true;
      totalJsBytes += info.jsBytes;
      totalCssBytes += info.cssBytes;
      routes[info.path] = {
        path: info.path,
        jsBytes: info.jsBytes,
        cssBytes: info.cssBytes,
        chunkIds: info.chunks,
      };
    }

    if (!anyChunks) return null;
    return {
      source: `${relative(process.cwd(), this.buildDir).split(sep).join("/")}/app-build-manifest.json`,
      totalJsBytes,
      totalCssBytes,
      routes,
    };
  }

  // ── internals ───────────────────────────────────────────

  private async readJson(rel: string, missing: string[]): Promise<unknown> {
    const full = join(this.buildDir, rel);
    try {
      const raw = await fs.readFile(full, "utf8");
      return JSON.parse(raw);
    } catch {
      missing.push(rel);
      return null;
    }
  }

  private async readNextVersion(): Promise<string | null> {
    try {
      const raw = await fs.readFile(join(this.buildDir, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { version?: string };
      return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
      return null;
    }
  }

  private async buildRoutes(input: {
    appBuildManifest: unknown;
    buildManifest: unknown;
    routesManifest: unknown;
    prerenderManifest: unknown;
    appPathsManifest: unknown;
    pagesManifest: unknown;
    functionsConfigManifest: unknown;
  }): Promise<Record<string, BuildOutputRouteInfo>> {
    const result: Record<string, BuildOutputRouteInfo> = {};

    const appPages = recordOf(getProp(input.appBuildManifest, "pages"));
    const pages = recordOf(getProp(input.buildManifest, "pages"));
    const dynamicRoutes = arrayOf(getProp(input.routesManifest, "dynamicRoutes"));
    const staticRoutes = arrayOf(getProp(input.routesManifest, "staticRoutes"));
    const prerenderRoutes = recordOf(getProp(input.prerenderManifest, "routes"));
    const dynamicPrerender = recordOf(getProp(input.prerenderManifest, "dynamicRoutes"));
    const functions = recordOf(getProp(input.functionsConfigManifest, "functions"));

    const allPaths = new Set<string>([
      ...Object.keys(appPages),
      ...Object.keys(pages),
      ...staticRoutes.map((r) => String(getProp(r, "page") ?? "")).filter(Boolean),
      ...dynamicRoutes.map((r) => String(getProp(r, "page") ?? "")).filter(Boolean),
      ...Object.keys(prerenderRoutes),
      ...Object.keys(dynamicPrerender),
    ]);

    for (const path of allPaths) {
      const chunksApp = stringArray(appPages[path]);
      const chunksPages = stringArray(pages[path]);
      const chunks = uniq([...chunksApp, ...chunksPages]);
      const { jsBytes, cssBytes } = await this.measureChunks(chunks);

      const prerender = prerenderRoutes[path] as Record<string, unknown> | undefined;
      const dynPrerender = dynamicPrerender[path] as Record<string, unknown> | undefined;
      const revalidate = numericOrNull(
        prerender?.["initialRevalidateSeconds"] ?? dynPrerender?.["fallbackRevalidate"]
      );

      let renderingMode: BuildOutputRouteInfo["renderingMode"] = "unknown";
      if (prerender) renderingMode = revalidate && revalidate > 0 ? "isr" : "ssg";
      else if (dynPrerender) renderingMode = revalidate && revalidate > 0 ? "isr" : "dynamic";
      else if (staticRoutes.some((r) => getProp(r, "page") === path)) renderingMode = "static";
      else if (dynamicRoutes.some((r) => getProp(r, "page") === path)) renderingMode = "dynamic";

      const fnConfig = functions[path] as Record<string, unknown> | undefined;
      const runtime = normalizeRuntime(fnConfig?.["runtime"]);
      const regions = stringArray(fnConfig?.["regions"]);

      result[path] = {
        path,
        renderingMode,
        revalidate,
        runtime,
        regions,
        chunks,
        jsBytes,
        cssBytes,
      };
    }

    return result;
  }

  private async measureChunks(chunks: string[]): Promise<{ jsBytes: number; cssBytes: number }> {
    let jsBytes = 0;
    let cssBytes = 0;
    for (const chunk of chunks) {
      try {
        const stat = await fs.stat(join(this.buildDir, chunk));
        if (chunk.endsWith(".css")) cssBytes += stat.size;
        else jsBytes += stat.size;
      } catch {
        // Missing chunk file — skip silently; surfaced via missingManifests would be misleading.
      }
    }
    return { jsBytes, cssBytes };
  }

  private extractServerActions(manifest: unknown): BuildOutputServerAction[] {
    if (!manifest || typeof manifest !== "object") return [];
    const node = getProp(manifest, "node");
    const edge = getProp(manifest, "edge");
    const out: BuildOutputServerAction[] = [];
    for (const bucket of [node, edge]) {
      const record = recordOf(bucket);
      for (const [id, entry] of Object.entries(record)) {
        const workers = recordOf(getProp(entry, "workers"));
        out.push({
          id,
          workers: Object.keys(workers),
          module: stringOrNull(getProp(entry, "layer")),
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  private extractClientBoundaries(manifest: unknown): BuildOutputClientBoundary[] {
    if (!manifest || typeof manifest !== "object") return [];
    const modules = recordOf(getProp(manifest, "clientModules"));
    const out: BuildOutputClientBoundary[] = [];
    for (const [id, entry] of Object.entries(modules)) {
      out.push({
        id,
        module: stringOrNull(getProp(entry, "id")) ?? id,
        chunks: stringArray(getProp(entry, "chunks")),
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  private extractMiddleware(manifest: unknown): BuildOutputMiddleware[] {
    if (!manifest || typeof manifest !== "object") return [];
    const middleware = recordOf(getProp(manifest, "middleware"));
    const out: BuildOutputMiddleware[] = [];
    for (const [name, entry] of Object.entries(middleware)) {
      const matchersRaw = arrayOf(getProp(entry, "matchers"));
      const matchers = matchersRaw
        .map((m) => (typeof m === "string" ? m : stringOrNull(getProp(m, "regexp"))))
        .filter((m): m is string => !!m);
      out.push({
        name,
        matchers,
        runtime: normalizeRuntime(getProp(entry, "runtime")),
      });
    }
    return out;
  }
}

// ── helpers ────────────────────────────────────────────────

function getProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayOf(value).filter((v): v is string => typeof v === "string");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRuntime(value: unknown): "nodejs" | "edge" | "unknown" {
  if (value === "edge" || value === "experimental-edge") return "edge";
  if (value === "nodejs" || value === "node") return "nodejs";
  return "unknown";
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
