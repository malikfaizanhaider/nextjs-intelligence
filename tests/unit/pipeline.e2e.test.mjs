import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";
import { validateManifest } from "../../dist/tools/intelligence-types/src/index.js";

/**
 * Build a small but representative Next.js fixture on disk:
 *   - app/layout.tsx                        (root layout)
 *   - app/page.tsx                          (home page renders Hero + SharedCard)
 *   - app/users/page.tsx                    (server page renders UserList)
 *   - app/users/[id]/page.tsx               (dynamic route renders UserDetail + SharedCard)
 *   - components/hero.tsx                   (client component)
 *   - components/shared-card.tsx            (reused across routes)
 *   - components/user-list.tsx
 *   - components/user-detail.tsx
 *   - components/data-grid.tsx              (composite: DataGrid.Header / DataGrid.Body)
 *   - tsconfig.json                         (required by ComponentAnalyzer)
 */
async function writeFixture(root) {
  const files = {
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "preserve",
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          allowJs: true,
          noEmit: true,
          baseUrl: ".",
        },
        include: ["app/**/*", "components/**/*"],
      },
      null,
      2
    ),

    "app/layout.tsx":
      `export default function RootLayout({ children }: { children: any }) {\n` +
      `  return <html><body>{children}</body></html>;\n` +
      `}\n`,

    "app/page.tsx":
      `import { Hero } from "../components/hero";\n` +
      `import { SharedCard } from "../components/shared-card";\n` +
      `export default function HomePage() {\n` +
      `  return <main><Hero /><SharedCard /></main>;\n` +
      `}\n`,

    "app/users/page.tsx":
      `import { UserList } from "../../components/user-list";\n` +
      `export default function UsersPage() {\n` +
      `  return <UserList />;\n` +
      `}\n`,

    "app/users/[id]/page.tsx":
      `import { UserDetail } from "../../../components/user-detail";\n` +
      `import { SharedCard } from "../../../components/shared-card";\n` +
      `export default function UserDetailPage({ params }: { params: { id: string } }) {\n` +
      `  return <><UserDetail id={params.id} /><SharedCard /></>;\n` +
      `}\n`,

    "components/hero.tsx":
      `"use client";\n` +
      `export function Hero() {\n` +
      `  return <h1>Hello</h1>;\n` +
      `}\n`,

    "components/shared-card.tsx":
      `export function SharedCard() {\n` +
      `  return <div className="card" />;\n` +
      `}\n`,

    "components/user-list.tsx":
      `import { SharedCard } from "./shared-card";\n` +
      `export function UserList() {\n` +
      `  return <ul><li><SharedCard /></li></ul>;\n` +
      `}\n`,

    "components/user-detail.tsx":
      `export function UserDetail({ id }: { id: string }) {\n` +
      `  return <article>{id}</article>;\n` +
      `}\n`,

    "components/data-grid.tsx":
      `function DataGridHeader() { return <thead />; }\n` +
      `function DataGridBody() { return <tbody />; }\n` +
      `export function DataGrid() { return <table />; }\n` +
      `DataGrid.Header = DataGridHeader;\n` +
      `DataGrid.Body = DataGridBody;\n`,

    // ── Phase C additions ───────────────────────────────
    "app/api/users/route.ts":
      `export async function GET() { return Response.json([]); }\n` +
      `export async function POST() { return new Response(null, { status: 201 }); }\n`,

    "app/api/users/[id]/route.ts":
      `export const GET = async () => Response.json({});\n` +
      `export const DELETE = async () => new Response(null, { status: 204 });\n`,

    "middleware.ts":
      `import { NextResponse } from "next/server";\n` +
      `export default function middleware() { return NextResponse.next(); }\n` +
      `export const config = { matcher: ["/dashboard/:path*"] };\n`,

    "app/@modal/page.tsx":
      `export default function ModalSlot() { return <div />; }\n`,

    "app/actions/user-actions.ts":
      `"use server";\n` +
      `export async function createUser(input: { name: string }) { return { id: 1, ...input }; }\n` +
      `export async function deleteUser(id: number) { return { ok: true }; }\n`,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
}

test("pipeline E2E: analyzes a mini Next.js fixture end-to-end", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-e2e-"));

  try {
    await writeFixture(root);

    const { manifest, telemetry } = await runIntelligencePipelineDetailed(
      {
        projectRoot: root,
        outputDir: join(root, ".generated/intelligence"),
        cacheDir: join(root, ".cache/intelligence"),
        incremental: false,
      },
      { logger: silentLogger }
    );

    // ── Manifest shape ───────────────────────────────────
    const validation = validateManifest(manifest);
    assert.equal(validation.valid, true, `manifest invalid: ${validation.errors.join("; ")}`);

    // ── Routes ───────────────────────────────────────────
    const routePaths = manifest.routes.map((r) => r.path).sort();
    assert.deepEqual(routePaths, ["/", "/users", "/users/[id]"]);

    const dynamic = manifest.routes.find((r) => r.path === "/users/[id]");
    assert.equal(dynamic?.segmentType, "dynamic");

    // ── Components discovered ────────────────────────────
    const exportNames = new Set(
      Object.values(manifest.components).map((c) => c.identity.exportName)
    );
    for (const expected of [
      "RootLayout",
      "HomePage",
      "UsersPage",
      "UserDetailPage",
      "Hero",
      "SharedCard",
      "UserList",
      "UserDetail",
      "DataGrid",
    ]) {
      assert.ok(exportNames.has(expected), `missing component ${expected}`);
    }

    // ── Composite detection ──────────────────────────────
    const dataGrid = Object.values(manifest.components).find((c) => c.name === "DataGrid");
    assert.ok(dataGrid, "DataGrid component not discovered");
    assert.equal(dataGrid.isComposite, true, "DataGrid should be detected as composite");
    assert.ok(
      dataGrid.subComponents.length >= 2,
      `DataGrid should have at least 2 sub-components; got ${dataGrid.subComponents.length}`
    );

    // ── Route intelligence + reuse ───────────────────────
    const homeIntel = manifest.routeIntelligence["/"];
    assert.ok(homeIntel, "missing route intelligence for /");
    assert.ok(homeIntel.dependencyCount >= 2, "home route should have >=2 dependencies");

    const sharedCard = Object.values(manifest.components).find((c) => c.name === "SharedCard");
    assert.ok(sharedCard, "SharedCard not found");
    assert.equal(
      sharedCard.isReusable,
      true,
      "SharedCard should be marked reusable (used in multiple routes)"
    );

    // ── Telemetry sanity ─────────────────────────────────
    assert.equal(telemetry.phases.length, 8, "expected 8 telemetry phases");
    assert.deepEqual(
      telemetry.phases.map((p) => p.name),
      [
        "discovery",
        "route-detection",
        "composite-detection",
        "canonicalization",
        "route-intelligence",
        "graph-build",
        "verification",
        "output",
      ]
    );
    assert.ok(telemetry.totalDurationMs >= 0);
    assert.ok(telemetry.parse.attempted >= 9, "should have attempted at least 9 files");
    assert.equal(telemetry.parse.failed, 0, "no parse failures expected on clean fixture");

    // ── Traversal cache (Phase B3) ───────────────────────
    // The shared per-file dependency cache should record at least one hit
    // on this 3-route fixture — Hero is imported by multiple routes and
    // SharedCard is imported transitively from several composites.
    const phase5 = telemetry.phases.find((p) => p.name === "route-intelligence");
    assert.ok(phase5, "expected route-intelligence phase");
    assert.ok(
      typeof phase5.counts?.traversalCacheHits === "number",
      "phase 5 counts should expose traversalCacheHits"
    );
    assert.ok(
      typeof phase5.counts?.traversalCacheMisses === "number",
      "phase 5 counts should expose traversalCacheMisses"
    );
    assert.ok(
      phase5.counts.traversalCacheHits > 0,
      `expected shared traversal cache to record hits; got ${phase5.counts.traversalCacheHits}`
    );

    // ── Phase C: API routes, middleware, parallel slots, server actions ──
    assert.ok(Array.isArray(manifest.apiRoutes), "manifest.apiRoutes must be an array");
    const apiPaths = manifest.apiRoutes.map((r) => r.path).sort();
    assert.deepEqual(apiPaths, ["/api/users", "/api/users/[id]"]);
    const apiUsers = manifest.apiRoutes.find((r) => r.path === "/api/users");
    assert.deepEqual(apiUsers.methods, ["GET", "POST"]);
    const apiUserById = manifest.apiRoutes.find((r) => r.path === "/api/users/[id]");
    assert.deepEqual(apiUserById.methods, ["DELETE", "GET"]);
    assert.equal(apiUserById.segmentType, "dynamic");

    assert.equal(manifest.middleware.length, 1, "expected one middleware entry");
    assert.deepEqual(manifest.middleware[0].matcher, ["/dashboard/:path*"]);
    assert.equal(manifest.middleware[0].hasDefaultExport, true);

    assert.equal(manifest.parallelSlots.length, 1, "expected one @modal slot");
    assert.equal(manifest.parallelSlots[0].name, "modal");
    assert.equal(manifest.parallelSlots[0].parentPath, "/");

    // Module-level "use server" produces sentinel + per-export entries.
    const actionNames = manifest.serverActions.map((a) => a.exportName).sort();
    assert.deepEqual(actionNames, ["__module__", "createUser", "deleteUser"]);
    for (const action of manifest.serverActions) {
      assert.equal(action.scope, "module");
      assert.equal(action.relativePath, "app/actions/user-actions.ts");
    }

    // Summary should reflect Phase C counts.
    assert.equal(manifest.summary.apiRoutes, 2);
    assert.equal(manifest.summary.middlewareCount, 1);
    assert.equal(manifest.summary.parallelSlots, 1);
    assert.equal(manifest.summary.serverActions, 3);

    // Component meta should flag files containing server actions.
    const actionFileComponents = Object.values(manifest.components).filter(
      (c) => c.relativePath === "app/actions/user-actions.ts"
    );
    // The actions file has no React components, so component count may be 0;
    // when there *are* components in the file they must have hasServerActions=true.
    for (const c of actionFileComponents) {
      assert.equal(c.hasServerActions, true);
    }

    // ── Output files written ─────────────────────────────
    const manifestPath = join(root, ".generated/intelligence/manifest.json");
    const written = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(written.projectRoot, manifest.projectRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pipeline E2E: determinism — two runs produce byte-identical manifest.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-determinism-"));

  try {
    await writeFixture(root);

    const outputDir = join(root, ".generated/intelligence");
    const cacheDir = join(root, ".cache/intelligence");

    await runIntelligencePipelineDetailed(
      { projectRoot: root, outputDir, cacheDir, incremental: false },
      { logger: silentLogger }
    );
    const first = await readFile(join(outputDir, "manifest.json"), "utf8");

    await runIntelligencePipelineDetailed(
      { projectRoot: root, outputDir, cacheDir, incremental: false },
      { logger: silentLogger }
    );
    const second = await readFile(join(outputDir, "manifest.json"), "utf8");

    // Strip only the volatile `generatedAt` timestamp before comparing.
    const stripTimestamp = (s) => s.replace(/"generatedAt":\s*"[^"]+"/, '"generatedAt":"<ts>"');
    assert.equal(stripTimestamp(first), stripTimestamp(second), "manifest.json is not deterministic across runs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pipeline E2E: parse-error diagnostics are emitted for unparseable files", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-parse-err-"));

  try {
    await writeFixture(root);
    // Drop a syntactically broken file under app/ — discovery globs will pick it up.
    await writeFile(
      join(root, "app/broken.tsx"),
      "export function Broken( { return <div ;\n",
      "utf8"
    );

    const { manifest, telemetry } = await runIntelligencePipelineDetailed(
      {
        projectRoot: root,
        outputDir: join(root, ".generated/intelligence"),
        cacheDir: join(root, ".cache/intelligence"),
        incremental: false,
      },
      { logger: silentLogger }
    );

    // ts-morph is permissive about JSX; broken files may still parse. The pipeline
    // must at least *consider* the file, and any failure must surface as a diagnostic
    // (not be silently swallowed). We verify the wiring: attempted count includes it,
    // and any parse failure produces a `parse-error` diagnostic.
    assert.ok(
      telemetry.parse.attempted >= 10,
      "broken file should be counted in parse attempts"
    );
    if (telemetry.parse.failed > 0) {
      const parseDiags = manifest.diagnostics.filter((d) => d.category === "parse-error");
      assert.equal(
        parseDiags.length,
        telemetry.parse.failed,
        "every parse failure must produce exactly one parse-error diagnostic"
      );
      assert.equal(parseDiags[0].severity, "warning");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
