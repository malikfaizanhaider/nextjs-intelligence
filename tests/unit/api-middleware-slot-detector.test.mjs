import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectApiRoutes,
  detectMiddleware,
  detectParallelSlots,
} from "../../dist/tools/intelligence-core/src/index.js";

async function withFixture(setup) {
  const root = await mkdtemp(join(tmpdir(), "intelligence-route-detector-"));
  try {
    await setup(root);
    return root;
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

async function writeAt(root, rel, content) {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

// ── detectApiRoutes ──────────────────────────────────────────

test("detectApiRoutes discovers route.ts handlers with HTTP method exports", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(
      r,
      "app/api/users/route.ts",
      `export async function GET() { return Response.json([]); }
export async function POST() { return new Response(null, { status: 201 }); }
`
    );
    await writeAt(
      r,
      "app/api/users/[id]/route.ts",
      `export const GET = async () => Response.json({});
export const DELETE = async () => new Response(null, { status: 204 });
`
    );
    await writeAt(
      r,
      "app/api/files/[...path]/route.ts",
      `export function GET() { return new Response("ok"); }
`
    );
  });

  try {
    const apiRoutes = await detectApiRoutes(root, "app");
    assert.equal(apiRoutes.length, 3);

    const byPath = Object.fromEntries(apiRoutes.map((r) => [r.path, r]));

    assert.deepEqual(byPath["/api/users"].methods, ["GET", "POST"]);
    assert.equal(byPath["/api/users"].segmentType, "static");
    assert.equal(byPath["/api/users"].isDynamic, false);

    assert.deepEqual(byPath["/api/users/[id]"].methods, ["DELETE", "GET"]);
    assert.equal(byPath["/api/users/[id]"].segmentType, "dynamic");
    assert.equal(byPath["/api/users/[id]"].isDynamic, true);

    assert.deepEqual(byPath["/api/files/[...path]"].methods, ["GET"]);
    assert.equal(byPath["/api/files/[...path]"].segmentType, "catch-all");
  } finally {
    await cleanup(root);
  }
});

test("detectApiRoutes returns empty array for app without route handlers", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(r, "app/page.tsx", `export default function Page() { return null; }`);
  });
  try {
    const result = await detectApiRoutes(root, "app");
    assert.deepEqual(result, []);
  } finally {
    await cleanup(root);
  }
});

// ── detectMiddleware ─────────────────────────────────────────

test("detectMiddleware finds middleware.ts at project root with matcher config", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(
      r,
      "middleware.ts",
      `import { NextResponse } from "next/server";
export default function middleware() { return NextResponse.next(); }
export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
`
    );
  });
  try {
    const result = await detectMiddleware(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].relativePath, "middleware.ts");
    assert.equal(result[0].hasDefaultExport, true);
    assert.deepEqual(result[0].matcher, ["/dashboard/:path*", "/api/:path*"]);
  } finally {
    await cleanup(root);
  }
});

test("detectMiddleware returns empty when no middleware file is present", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(r, "app/page.tsx", `export default function Page() {}`);
  });
  try {
    const result = await detectMiddleware(root);
    assert.deepEqual(result, []);
  } finally {
    await cleanup(root);
  }
});

test("detectMiddleware reports matcher: null when matcher is dynamic", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(
      r,
      "middleware.ts",
      `export default function middleware() {}
const PATTERNS = ["/x"];
export const config = { matcher: PATTERNS };
`
    );
  });
  try {
    const result = await detectMiddleware(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].matcher, null);
  } finally {
    await cleanup(root);
  }
});

// ── detectParallelSlots ──────────────────────────────────────

test("detectParallelSlots discovers @slot pages and attaches to parent path", async () => {
  const root = await withFixture(async (r) => {
    await writeAt(r, "app/layout.tsx", `export default function L({ children, modal, sidebar }) { return null; }`);
    await writeAt(r, "app/page.tsx", `export default function Page() { return null; }`);
    await writeAt(
      r,
      "app/@modal/page.tsx",
      `export default function ModalSlot() { return null; }`
    );
    await writeAt(
      r,
      "app/@modal/default.tsx",
      `export default function ModalDefault() { return null; }`
    );
    await writeAt(
      r,
      "app/@sidebar/page.tsx",
      `export default function SidebarSlot() { return null; }`
    );
    await writeAt(
      r,
      "app/dashboard/@stats/page.tsx",
      `export default function StatsSlot() { return null; }`
    );
  });

  try {
    const slots = await detectParallelSlots(root, "app");
    assert.equal(slots.length, 3);

    const byKey = Object.fromEntries(
      slots.map((s) => [`${s.parentPath}#${s.name}`, s])
    );

    assert.ok(byKey["/dashboard#stats"]);
    assert.equal(byKey["/dashboard#stats"].hasDefault, false);

    assert.ok(byKey["/#modal"]);
    assert.equal(byKey["/#modal"].hasDefault, true);

    assert.ok(byKey["/#sidebar"]);
    assert.equal(byKey["/#sidebar"].hasDefault, false);
  } finally {
    await cleanup(root);
  }
});
