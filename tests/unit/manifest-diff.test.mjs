import test from "node:test";
import assert from "node:assert/strict";

import {
  diffManifests,
  formatManifestDiff,
} from "../../dist/tools/intelligence-core/src/index.js";

/**
 * Build a minimal manifest stub. Only the fields touched by diffManifests
 * are populated; everything else is left at empty defaults — diffManifests
 * tolerates this because every field access is null-coalesced.
 */
function manifest({ routes = {}, components = {}, diagnostics = [] } = {}) {
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    projectRoot: "/tmp",
    summary: {},
    routes: [],
    routeIntelligence: routes,
    components,
    componentUsage: {},
    graph: { nodes: [], edges: [] },
    graphs: {},
    runtime: {},
    diagnostics,
    apiRoutes: [],
    middleware: [],
    parallelSlots: [],
    serverActions: [],
  };
}

function route(path, deps = 0, components = []) {
  return {
    path,
    filePath: `app${path}/page.tsx`,
    relativePath: `app${path}/page.tsx`,
    segmentType: "page",
    searchParams: {},
    dynamicParams: [],
    components,
    lazyComponents: [],
    eagerComponents: components,
    hooks: [],
    utils: [],
    providers: [],
    dialogs: [],
    grids: [],
    charts: [],
    dependencies: [],
    dependencyCount: deps,
    complexity: { depth: 1, components: components.length, dependencies: deps },
    layoutFilePath: null,
    loadingFilePath: null,
    errorFilePath: null,
    templateFilePath: null,
    isRouteGroup: false,
    parentRoute: null,
  };
}

test("diffManifests: detects added and removed routes", () => {
  const prev = manifest({ routes: { "/a": route("/a"), "/b": route("/b") } });
  const curr = manifest({ routes: { "/a": route("/a"), "/c": route("/c") } });
  const d = diffManifests(prev, curr);
  assert.deepEqual(d.routes.added, ["/c"]);
  assert.deepEqual(d.routes.removed, ["/b"]);
  assert.equal(d.routes.changed.length, 0);
});

test("diffManifests: detects component-set changes within a route", () => {
  const prev = manifest({ routes: { "/x": route("/x", 2, ["Foo", "Bar"]) } });
  const curr = manifest({ routes: { "/x": route("/x", 3, ["Foo", "Baz"]) } });
  const d = diffManifests(prev, curr);
  assert.equal(d.routes.changed.length, 1);
  const change = d.routes.changed[0];
  assert.equal(change.path, "/x");
  assert.equal(change.dependencyCountBefore, 2);
  assert.equal(change.dependencyCountAfter, 3);
  assert.deepEqual(change.componentsAdded, ["Baz"]);
  assert.deepEqual(change.componentsRemoved, ["Bar"]);
});

test("diffManifests: ignores routes with no semantic change", () => {
  const prev = manifest({ routes: { "/x": route("/x", 1, ["Foo"]) } });
  const curr = manifest({ routes: { "/x": route("/x", 1, ["Foo"]) } });
  const d = diffManifests(prev, curr);
  assert.equal(d.routes.changed.length, 0);
});

test("diffManifests: component map add/remove", () => {
  const prev = manifest({ components: { A: {}, B: {} } });
  const curr = manifest({ components: { B: {}, C: {} } });
  const d = diffManifests(prev, curr);
  assert.deepEqual(d.components.added, ["C"]);
  assert.deepEqual(d.components.removed, ["A"]);
});

test("diffManifests: diagnostic add/resolve with severity delta", () => {
  const prev = manifest({
    diagnostics: [
      { category: "x", severity: "warning", message: "old", file: "a.ts" },
    ],
  });
  const curr = manifest({
    diagnostics: [
      { category: "y", severity: "error", message: "new", file: "b.ts" },
    ],
  });
  const d = diffManifests(prev, curr);
  assert.equal(d.diagnostics.errorDelta, 1);
  assert.equal(d.diagnostics.warningDelta, -1);
  assert.equal(d.diagnostics.added.length, 1);
  assert.equal(d.diagnostics.added[0].message, "new");
  assert.equal(d.diagnostics.resolved.length, 1);
  assert.equal(d.diagnostics.resolved[0].message, "old");
});

test("formatManifestDiff: empty string when nothing changed", () => {
  const m = manifest({ routes: { "/x": route("/x") } });
  const d = diffManifests(m, m);
  assert.equal(formatManifestDiff(d), "");
});

test("formatManifestDiff: includes added/removed markers and signed deltas", () => {
  const prev = manifest({ routes: { "/old": route("/old") } });
  const curr = manifest({
    routes: { "/new": route("/new") },
    diagnostics: [{ category: "c", severity: "error", message: "m", file: "f" }],
  });
  const d = diffManifests(prev, curr);
  const out = formatManifestDiff(d);
  assert.match(out, /\+ \/new/);
  assert.match(out, /- \/old/);
  assert.match(out, /errors \+1/);
  assert.match(out, /\[error\] c: m \(f\)/);
});
