import test from "node:test";
import assert from "node:assert/strict";

import { deriveBundleDiagnostics } from "../../dist/tools/intelligence-core/src/index.js";

/** Build minimal bundle stats with the given per-route entries. */
function buildStats(routes) {
  let totalJs = 0;
  let totalCss = 0;
  for (const r of Object.values(routes)) {
    totalJs += r.jsBytes ?? 0;
    totalCss += r.cssBytes ?? 0;
  }
  return {
    source: "test",
    totalJsBytes: totalJs,
    totalCssBytes: totalCss,
    routes,
  };
}

function route(path, overrides = {}) {
  return {
    path,
    jsBytes: 0,
    cssBytes: 0,
    chunkIds: [],
    ...overrides,
  };
}

test("returns no diagnostics when budget is empty", () => {
  const stats = buildStats({ "/": route("/", { jsBytes: 1_000_000 }) });
  assert.deepEqual(deriveBundleDiagnostics(stats, {}), []);
});

test("returns no diagnostics when all routes are within budget", () => {
  const stats = buildStats({
    "/": route("/", { jsBytes: 100, cssBytes: 50 }),
    "/about": route("/about", { jsBytes: 200, cssBytes: 60 }),
  });
  const diags = deriveBundleDiagnostics(stats, {
    maxRouteJsBytes: 1000,
    maxRouteCssBytes: 1000,
  });
  assert.deepEqual(diags, []);
});

test("emits an oversized-route warning for JS over budget", () => {
  const stats = buildStats({ "/heavy": route("/heavy", { jsBytes: 5000 }) });
  const diags = deriveBundleDiagnostics(stats, { maxRouteJsBytes: 1000 });
  assert.equal(diags.length, 1);
  const [d] = diags;
  assert.equal(d.category, "oversized-route");
  assert.equal(d.severity, "warning");
  assert.equal(d.nodeId, "route::/heavy");
  assert.equal(d.context.metric, "jsBytes");
  assert.equal(d.context.jsBytes, 5000);
  assert.equal(d.context.budget, 1000);
  assert.ok(typeof d.suggestion === "string" && d.suggestion.length > 0);
});

test("emits a warning for firstLoadJs over budget only when present", () => {
  const withFirstLoad = buildStats({
    "/a": route("/a", { firstLoadJs: 9000 }),
  });
  const withoutFirstLoad = buildStats({
    "/b": route("/b"),
  });
  const budget = { maxFirstLoadJsBytes: 1000 };

  const diagsA = deriveBundleDiagnostics(withFirstLoad, budget);
  assert.equal(diagsA.length, 1);
  assert.equal(diagsA[0].context.metric, "firstLoadJs");

  // No firstLoadJs field => no diagnostic (avoids false positives).
  const diagsB = deriveBundleDiagnostics(withoutFirstLoad, budget);
  assert.deepEqual(diagsB, []);
});

test("emits an info diagnostic for CSS over budget", () => {
  const stats = buildStats({ "/styled": route("/styled", { cssBytes: 4000 }) });
  const diags = deriveBundleDiagnostics(stats, { maxRouteCssBytes: 1000 });
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, "info");
  assert.equal(diags[0].context.metric, "cssBytes");
});

test("is deterministic: routes evaluated in sorted path order", () => {
  const stats = buildStats({
    "/zebra": route("/zebra", { jsBytes: 5000 }),
    "/alpha": route("/alpha", { jsBytes: 5000 }),
    "/mango": route("/mango", { jsBytes: 5000 }),
  });
  const diags = deriveBundleDiagnostics(stats, { maxRouteJsBytes: 1000 });
  assert.deepEqual(
    diags.map((d) => d.context.path),
    ["/alpha", "/mango", "/zebra"]
  );
});

test("emits multiple diagnostics per route when several metrics exceed", () => {
  const stats = buildStats({
    "/big": route("/big", { jsBytes: 5000, cssBytes: 4000, firstLoadJs: 9000 }),
  });
  const diags = deriveBundleDiagnostics(stats, {
    maxRouteJsBytes: 1000,
    maxRouteCssBytes: 1000,
    maxFirstLoadJsBytes: 1000,
  });
  assert.equal(diags.length, 3);
  const metrics = diags.map((d) => d.context.metric).sort();
  assert.deepEqual(metrics, ["cssBytes", "firstLoadJs", "jsBytes"]);
});
