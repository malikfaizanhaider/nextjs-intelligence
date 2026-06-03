import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryTraversalCache,
} from "../../dist/tools/intelligence-core/src/index.js";

test("InMemoryTraversalCache records hits and misses on getDeps", () => {
  const cache = new InMemoryTraversalCache();
  assert.equal(cache.stats.hits, 0);
  assert.equal(cache.stats.misses, 0);

  // miss
  assert.equal(cache.getDeps("/a.ts"), undefined);
  assert.equal(cache.stats.misses, 1);

  cache.setDeps("/a.ts", []);
  const hit = cache.getDeps("/a.ts");
  assert.deepEqual(hit, []);
  assert.equal(cache.stats.hits, 1);
});

test("InMemoryTraversalCache stores and replays hook names", () => {
  const cache = new InMemoryTraversalCache();
  assert.equal(cache.getHooks("/x.ts"), undefined);
  cache.setHooks("/x.ts", ["useThing"]);
  assert.deepEqual(cache.getHooks("/x.ts"), ["useThing"]);
});

test("InMemoryTraversalCache.clear() resets entries and stats", () => {
  const cache = new InMemoryTraversalCache();
  cache.setDeps("/a.ts", []);
  cache.setHooks("/a.ts", ["useThing"]);
  cache.getDeps("/a.ts"); // hit
  cache.getHooks("/a.ts"); // hooks getter does not track stats

  cache.clear();
  assert.equal(cache.getDeps("/a.ts"), undefined);
  assert.equal(cache.getHooks("/a.ts"), undefined);
  assert.equal(cache.stats.hits, 0);
  // Only `getDeps` records misses; one fresh miss after clear().
  assert.equal(cache.stats.misses, 1);
});
