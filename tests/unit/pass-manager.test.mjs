import test from "node:test";
import assert from "node:assert/strict";

import {
  PassManager,
  PassScheduleError,
} from "../../dist/tools/intelligence-core/src/index.js";

function makePass(id, stage, dependsOn, sink) {
  return {
    id,
    stage,
    dependsOn,
    async run() {
      sink.push(id);
    },
  };
}

test("PassManager runs passes in topological order respecting dependsOn", async () => {
  const manager = new PassManager();
  const order = [];

  // c depends on b, b depends on a — declaration order is intentionally reversed.
  manager.register(makePass("c", "verify", ["b"], order));
  manager.register(makePass("b", "analyze", ["a"], order));
  manager.register(makePass("a", "build-ir", [], order));

  await manager.runAll();

  assert.deepEqual(order, ["a", "b", "c"]);
});

test("PassManager breaks ties deterministically by (stage, id)", async () => {
  const manager = new PassManager();
  const order = [];

  // Three independent passes — should sort by stage first, then id.
  manager.register(makePass("zeta", "analyze", [], order));
  manager.register(makePass("alpha", "build-ir", [], order));
  manager.register(makePass("beta", "build-ir", [], order));

  await manager.runAll();

  assert.deepEqual(order, ["alpha", "beta", "zeta"]);
});

test("PassManager.plan() returns the same order as runAll() without executing", () => {
  const manager = new PassManager();
  const order = [];

  manager.register(makePass("b", "analyze", ["a"], order));
  manager.register(makePass("a", "build-ir", [], order));

  const planned = manager.plan().map((p) => p.id);
  assert.deepEqual(planned, ["a", "b"]);
  assert.deepEqual(order, [], "plan() must not execute passes");
});

test("PassManager throws PassScheduleError on cycle", () => {
  const manager = new PassManager();
  const sink = [];

  manager.register(makePass("a", "build-ir", ["b"], sink));
  manager.register(makePass("b", "analyze", ["a"], sink));

  assert.throws(
    () => manager.plan(),
    (err) => err instanceof PassScheduleError && /Cycle detected/.test(err.message)
  );
});

test("PassManager throws on unknown dependsOn", () => {
  const manager = new PassManager();
  const sink = [];

  manager.register(makePass("a", "build-ir", ["does-not-exist"], sink));

  assert.throws(
    () => manager.plan(),
    (err) => err instanceof PassScheduleError && /unknown pass/.test(err.message)
  );
});

test("PassManager rejects duplicate pass IDs at registration", () => {
  const manager = new PassManager();
  const sink = [];

  manager.register(makePass("dup", "build-ir", [], sink));
  assert.throws(
    () => manager.register(makePass("dup", "analyze", [], sink)),
    /Duplicate pass id/
  );
});

test("PassManager ledger records durations for each pass", async () => {
  const manager = new PassManager();
  const sink = [];

  manager.register(makePass("a", "build-ir", [], sink));
  manager.register(makePass("b", "analyze", ["a"], sink));

  await manager.runAll();
  const ledger = manager.getLedger();
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].passId, "a");
  assert.equal(ledger[1].passId, "b");
  for (const record of ledger) {
    assert.ok(record.durationMs >= 0, "durationMs should be >= 0");
    assert.ok(typeof record.deterministicOrderKey === "string");
  }
});
