import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "intelligence-incr-"));
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        jsx: "preserve",
        moduleResolution: "Bundler",
        strict: false,
        allowJs: true,
        noEmit: true,
        skipLibCheck: true,
        baseUrl: ".",
      },
      include: ["app/**/*"],
    })
  );
  await writeFile(
    join(root, "app/page.tsx"),
    `export default function HomePage() { return <main>home</main>; }\n`,
    "utf8"
  );
  await mkdir(join(root, "app/about"), { recursive: true });
  await writeFile(
    join(root, "app/about/page.tsx"),
    `export default function AboutPage() { return <section>about</section>; }\n`,
    "utf8"
  );
  return root;
}

test("incremental: second run with no changes short-circuits via cache", async () => {
  const root = await makeFixture();
  try {
    const first = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );
    assert.ok(first.telemetry.incremental, "telemetry.incremental populated on first run");
    assert.equal(first.telemetry.incremental.cacheHit, false, "first run is not a cache hit");
    assert.equal(first.telemetry.incremental.addedFiles, first.telemetry.incremental.totalFiles);
    assert.ok(first.telemetry.phases.length === 8, "first run executes all 8 phases");

    const second = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );
    assert.equal(second.telemetry.incremental?.cacheHit, true, "second run hits cache");
    assert.equal(second.telemetry.phases.length, 0, "short-circuit skips phase execution");
    assert.equal(
      second.telemetry.incremental.unchangedFiles,
      second.telemetry.incremental.totalFiles
    );
    assert.deepEqual(
      Object.keys(second.manifest.components).sort(),
      Object.keys(first.manifest.components).sort(),
      "reused manifest exposes same components as the first run"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incremental: modifying a file invalidates the cache and re-runs", async () => {
  const root = await makeFixture();
  try {
    await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );

    // Touch a single file.
    await writeFile(
      join(root, "app/page.tsx"),
      `export default function HomePage() { return <main>home updated</main>; }\n`,
      "utf8"
    );

    const next = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );
    assert.equal(next.telemetry.incremental?.cacheHit, false, "modified file forces full run");
    assert.equal(next.telemetry.incremental.changedFiles, 1, "exactly one file flagged changed");
    assert.equal(next.telemetry.phases.length, 8, "all phases re-executed on invalidation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incremental: disabled by default? respects incremental:false", async () => {
  const root = await makeFixture();
  try {
    const result = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );
    assert.equal(
      result.telemetry.incremental,
      undefined,
      "no incremental telemetry when feature is disabled"
    );

    // No cache file should have been written.
    const cacheFile = join(root, "node_modules/.cache/intelligence/intelligence-cache.json");
    await assert.rejects(readFile(cacheFile, "utf-8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Per-file (partial) reuse: when only some files change, routes whose
// `dependencyFiles` set is untouched must reuse the prior RouteIntelligence
// entry. This skips the expensive recursive AST traversal in Phase 5.
// ----------------------------------------------------------------------------

async function makeMultiRouteFixture() {
  const root = await mkdtemp(join(tmpdir(), "intelligence-reuse-"));
  await mkdir(join(root, "app/home"), { recursive: true });
  await mkdir(join(root, "app/about"), { recursive: true });
  await mkdir(join(root, "components"), { recursive: true });
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        jsx: "preserve",
        moduleResolution: "Bundler",
        strict: false,
        allowJs: true,
        noEmit: true,
        skipLibCheck: true,
        baseUrl: ".",
      },
      include: ["app/**/*", "components/**/*"],
    })
  );
  // HomeWidget is used ONLY by /home — modifying it must not invalidate /about.
  await writeFile(
    join(root, "components/HomeWidget.tsx"),
    `export function HomeWidget() { return <div>home widget</div>; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "components/AboutWidget.tsx"),
    `export function AboutWidget() { return <div>about widget</div>; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "app/home/page.tsx"),
    `import { HomeWidget } from "../../components/HomeWidget";\nexport default function HomePage() { return <HomeWidget />; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "app/about/page.tsx"),
    `import { AboutWidget } from "../../components/AboutWidget";\nexport default function AboutPage() { return <AboutWidget />; }\n`,
    "utf8"
  );
  return root;
}

test("incremental B2.1: modifying one route's dep reuses other untouched routes", async () => {
  const root = await makeMultiRouteFixture();
  try {
    const first = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );
    // Sanity: every route gained a dependencyFiles list.
    for (const intel of Object.values(first.manifest.routeIntelligence)) {
      assert.ok(
        Array.isArray(intel.dependencyFiles) && intel.dependencyFiles.length > 0,
        `route ${intel.path} should have non-empty dependencyFiles`
      );
    }

    // Modify only HomeWidget — /about's dependency set is untouched.
    await writeFile(
      join(root, "components/HomeWidget.tsx"),
      `export function HomeWidget() { return <div>home widget v2</div>; }\n`,
      "utf8"
    );

    const second = await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: true },
      { logger: silentLogger, skipConfigFile: true }
    );
    assert.equal(second.telemetry.incremental?.cacheHit, false, "partial change is not a full cache hit");
    assert.equal(second.telemetry.incremental.changedFiles, 1, "exactly one file flagged changed");
    assert.equal(
      second.telemetry.incremental.reusedRoutes,
      1,
      "exactly one route (/about) should be reused"
    );

    // The reused /about route must be byte-identical to the first run.
    assert.deepStrictEqual(
      second.manifest.routeIntelligence["/about"],
      first.manifest.routeIntelligence["/about"],
      "/about RouteIntelligence must be reused verbatim"
    );
    assert.ok(
      "/home" in second.manifest.routeIntelligence,
      "/home should still appear in manifest after re-analysis"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
