import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";

/**
 * Phase C4 — lazy import tracking.
 *
 * Build a fixture that mixes eager and lazy imports of the same and different
 * components, then verify the resulting RouteIntelligence correctly splits
 * `eagerComponents` and `lazyComponents`.
 */
async function writeLazyFixture(root) {
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

    // Eager: Hero. Lazy: HeavyChart via next/dynamic. Lazy import(): Modal.
    "app/page.tsx":
      `import { Hero } from "../components/hero";\n` +
      `import dynamic from "next/dynamic";\n` +
      `const HeavyChart = dynamic(() => import("../components/heavy-chart"));\n` +
      `export default function HomePage() {\n` +
      `  if (typeof window !== "undefined") {\n` +
      `    void import("../components/modal");\n` +
      `  }\n` +
      `  return <main><Hero /><HeavyChart /></main>;\n` +
      `}\n`,

    // Another route also imports HeavyChart EAGERLY — this should force
    // HeavyChart to surface as eager (the lazy-only invariant).
    "app/charts/page.tsx":
      `import { HeavyChart } from "../../components/heavy-chart";\n` +
      `export default function ChartsPage() {\n` +
      `  return <HeavyChart />;\n` +
      `}\n`,

    "components/hero.tsx":
      `"use client";\n` +
      `export function Hero() { return <h1>Hi</h1>; }\n`,

    "components/heavy-chart.tsx":
      `"use client";\n` +
      `export function HeavyChart() { return <canvas />; }\n` +
      `export default HeavyChart;\n`,

    "components/modal.tsx":
      `"use client";\n` +
      `export default function Modal() { return <div className="modal" />; }\n`,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
}

test("Phase C4: lazy imports populate lazyComponents and eagerComponents", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-lazy-"));
  try {
    await writeLazyFixture(root);

    const { manifest } = await runIntelligencePipelineDetailed(
      {
        projectRoot: root,
        outputDir: join(root, ".generated/intelligence"),
        cacheDir: join(root, ".cache/intelligence"),
        incremental: false,
      },
      { logger: silentLogger }
    );

    const home = manifest.routeIntelligence["/"];
    assert.ok(home, "missing route intelligence for /");

    // Both buckets must exist and be string arrays.
    assert.ok(Array.isArray(home.lazyComponents), "home.lazyComponents must be an array");
    assert.ok(Array.isArray(home.eagerComponents), "home.eagerComponents must be an array");

    // Hero is reached eagerly only ⇒ eager.
    assert.ok(home.eagerComponents.includes("Hero"), `expected Hero in eagerComponents; got ${home.eagerComponents.join(",")}`);
    assert.ok(!home.lazyComponents.includes("Hero"));

    // Modal is reached ONLY via `import("../components/modal")` ⇒ lazy.
    assert.ok(home.lazyComponents.includes("Modal"), `expected Modal in lazyComponents; got ${home.lazyComponents.join(",")}`);

    // HeavyChart is reached lazily from / and eagerly from /charts. The
    // eager/lazy split is computed PER ROUTE, so on / HeavyChart is lazy and
    // on /charts it is eager.
    assert.ok(home.lazyComponents.includes("HeavyChart"), `HeavyChart should be lazy on /; got eager=${home.eagerComponents.join(",")} lazy=${home.lazyComponents.join(",")}`);
    assert.ok(!home.eagerComponents.includes("HeavyChart"));

    const charts = manifest.routeIntelligence["/charts"];
    assert.ok(charts, "missing route intelligence for /charts");
    assert.ok(charts.eagerComponents.includes("HeavyChart"));
    assert.ok(!charts.lazyComponents.includes("HeavyChart"));

    // Sanity: components union holds everything once.
    for (const name of ["Hero", "HeavyChart", "Modal"]) {
      assert.ok(home.components.includes(name) || charts.components.includes(name), `${name} missing from any route's components`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
