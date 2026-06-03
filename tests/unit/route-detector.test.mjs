import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectRoutes } from "../../dist/tools/intelligence-core/src/analyzer/route-detector.js";

async function writePage(root, relativeFile) {
  const absoluteFile = join(root, relativeFile);
  await mkdir(join(absoluteFile, ".."), { recursive: true });
  await writeFile(absoluteFile, "export default function Page() { return null; }\n", "utf8");
  return absoluteFile;
}

test("detectRoutes discovers App Router pages and route metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-routes-"));

  try {
    await writePage(root, "app/page.tsx");
    await writePage(root, "app/(marketing)/about/page.tsx");
    await writePage(root, "app/blog/[slug]/page.tsx");
    await writePage(root, "app/docs/[...parts]/page.tsx");
    await writePage(root, "app/shop/[[...path]]/page.tsx");
    await writeFile(join(root, "app/(marketing)/about/layout.tsx"), "export default function Layout() { return null; }\n", "utf8");

    const routes = await detectRoutes(root, "app");
    const byPath = new Map(routes.map((route) => [route.path, route]));

    assert.deepEqual([...byPath.keys()], ["/", "/about", "/blog/[slug]", "/docs/[...parts]", "/shop/[[...path]]"]);

    assert.equal(byPath.get("/").segmentType, "static");
    assert.equal(byPath.get("/").parentRoute, null);
    assert.equal(byPath.get("/about").isRouteGroup, true);
    assert.equal(byPath.get("/about").parentRoute, "/");
    assert.match(byPath.get("/about").layoutFilePath, /layout\.tsx$/);
    assert.equal(byPath.get("/blog/[slug]").segmentType, "dynamic");
    assert.equal(byPath.get("/docs/[...parts]").segmentType, "catch-all");
    assert.equal(byPath.get("/shop/[[...path]]").segmentType, "optional-catch-all");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
