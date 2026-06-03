import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IncrementalCache } from "../../dist/tools/intelligence-core/src/index.js";

async function withTmpDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "intelligence-cache-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("classifyChanges splits files into added/changed/removed/unchanged", async () => {
  await withTmpDir(async (dir) => {
    const cache = new IncrementalCache(dir);
    await cache.load();

    // Seed cache: a (unchanged), b (will be changed), c (will be removed).
    cache.update("a.ts", "alpha");
    cache.update("b.ts", "beta-v1");
    cache.update("c.ts", "gamma");

    const result = cache.classifyChanges([
      { filePath: "a.ts", content: "alpha" },
      { filePath: "b.ts", content: "beta-v2" },
      { filePath: "d.ts", content: "delta" },
    ]);

    assert.deepEqual(result.added, ["d.ts"]);
    assert.deepEqual(result.changed, ["b.ts"]);
    assert.deepEqual(result.removed, ["c.ts"]);
    assert.deepEqual(result.unchanged, ["a.ts"]);
  });
});

test("getChangedFiles returns the invalidation frontier (added \u222a changed \u222a removed)", async () => {
  await withTmpDir(async (dir) => {
    const cache = new IncrementalCache(dir);
    await cache.load();
    cache.update("a.ts", "v1");
    cache.update("b.ts", "v1");

    const changed = cache.getChangedFiles([
      { filePath: "a.ts", content: "v1" }, // unchanged
      { filePath: "b.ts", content: "v2" }, // changed
      { filePath: "c.ts", content: "v1" }, // added
      // a.ts kept, b.ts modified, c.ts new, removed: none
    ]);

    assert.deepEqual(changed.sort(), ["b.ts", "c.ts"]);
  });
});

test("classifyChanges with an empty cache treats every file as added", async () => {
  await withTmpDir(async (dir) => {
    const cache = new IncrementalCache(dir);
    await cache.load();

    const result = cache.classifyChanges([
      { filePath: "a.ts", content: "x" },
      { filePath: "b.ts", content: "y" },
    ]);

    assert.deepEqual(result.added.sort(), ["a.ts", "b.ts"]);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.unchanged, []);
  });
});
