import test from "node:test";
import assert from "node:assert/strict";

import { deriveMetrics } from "../../dist/tools/intelligence-core/src/index.js";

/** Build a minimal manifest with enough surface for deriveMetrics. */
function buildManifest({
  components = {},
  routeIntelligence = {},
  componentUsage = {},
  runtime = {},
  diagnostics = [],
  graphEdges = [],
  routes = [],
} = {}) {
  return {
    schemaVersion: "1.1.0",
    generatedAt: "2026-01-01T00:00:00Z",
    projectRoot: "/tmp",
    summary: {},
    routes,
    routeIntelligence,
    components,
    componentUsage,
    graph: { nodes: [], edges: graphEdges },
    graphs: {
      import: { nodes: [], edges: [] },
      render: { nodes: [], edges: [] },
      compositeOwnership: { nodes: [], edges: [] },
      runtimeMount: { nodes: [], edges: [] },
    },
    runtime,
    diagnostics,
    apiRoutes: [],
    middleware: [],
    parallelSlots: [],
    serverActions: [],
  };
}

function comp(id, overrides = {}) {
  return {
    identity: { canonicalId: id, sourceFile: id, exportName: "X", absolutePath: id, compositeRoot: null },
    id,
    name: overrides.name ?? id.split("#").at(-1) ?? id,
    filePath: id,
    relativePath: id.split("#")[0],
    type: "component",
    rendering: "client",
    exportType: "named",
    imports: [],
    jsxChildren: [],
    usedInRoutes: [],
    usedInFiles: [],
    isReusable: false,
    isDynamicImport: false,
    line: 1,
    column: 1,
    isComposite: false,
    subComponents: [],
    subComponentIds: [],
    confidence: { score: 1, evidence: [] },
    ...overrides,
  };
}

function routeIntel(path, overrides = {}) {
  return {
    path,
    filePath: `app${path}/page.tsx`,
    relativePath: `app${path}/page.tsx`,
    segmentType: "static",
    searchParams: {},
    dynamicParams: [],
    components: [],
    lazyComponents: [],
    eagerComponents: [],
    hooks: [],
    utils: [],
    providers: [],
    dialogs: [],
    grids: [],
    dependencies: [],
    dependencyCount: 0,
    charts: [],
    complexity: { depth: 1, components: 0, dependencies: 0 },
    layoutFilePath: null,
    loadingFilePath: null,
    errorFilePath: null,
    templateFilePath: null,
    isRouteGroup: false,
    parentRoute: null,
    ...overrides,
  };
}

test("deriveMetrics: emits version, totals, and empty bundle when stats absent", () => {
  const m = buildManifest();
  const d = deriveMetrics(m);
  assert.equal(d.version, "1.0.0");
  assert.deepEqual(d.totals, {
    components: 0,
    routes: 0,
    deadComponents: 0,
    reusableComponents: 0,
    diagnostics: 0,
  });
  assert.equal(d.bundle, undefined);
  assert.equal(d.diagnosticDensity, 0);
});

test("deriveMetrics: flags components with no inbound references as dead", () => {
  const m = buildManifest({
    components: {
      "a.tsx#Used": comp("a.tsx#Used", { usedInFiles: ["b.tsx"] }),
      "c.tsx#Dead": comp("c.tsx#Dead"),
    },
  });
  const d = deriveMetrics(m);
  assert.deepEqual(d.deadComponents, ["c.tsx#Dead"]);
  assert.equal(d.totals.deadComponents, 1);
  assert.equal(d.components["c.tsx#Dead"].isDead, true);
  assert.equal(d.components["a.tsx#Used"].isDead, false);
});

test("deriveMetrics: reusability score scales with route + file breadth", () => {
  const m = buildManifest({
    components: {
      "a.tsx#A": comp("a.tsx#A", { usedInFiles: ["x.tsx"] }),
      "b.tsx#B": comp("b.tsx#B", {
        usedInFiles: ["x.tsx", "y.tsx", "z.tsx", "w.tsx", "q.tsx"],
      }),
    },
    componentUsage: {
      "a.tsx#A": { usedInRoutes: ["/a"], usageCount: 1, type: "component", filePath: "a.tsx" },
      "b.tsx#B": {
        usedInRoutes: ["/a", "/b", "/c", "/d", "/e"],
        usageCount: 5,
        type: "component",
        filePath: "b.tsx",
      },
    },
  });
  const d = deriveMetrics(m);
  assert.ok(
    d.components["b.tsx#B"].reusabilityScore > d.components["a.tsx#A"].reusabilityScore,
    "more shared component should score higher"
  );
  assert.equal(d.topReusable[0].canonicalId, "b.tsx#B");
});

test("deriveMetrics: route metrics include lazy ratio, complexity, hotness", () => {
  const m = buildManifest({
    routes: [
      { path: "/heavy", filePath: "app/heavy/page.tsx", relativePath: "app/heavy/page.tsx", segmentType: "static", layoutFilePath: null, loadingFilePath: null, errorFilePath: null, templateFilePath: null, components: [], isRouteGroup: false, parentRoute: null },
      { path: "/light", filePath: "app/light/page.tsx", relativePath: "app/light/page.tsx", segmentType: "static", layoutFilePath: null, loadingFilePath: null, errorFilePath: null, templateFilePath: null, components: [], isRouteGroup: false, parentRoute: null },
    ],
    routeIntelligence: {
      "/heavy": routeIntel("/heavy", {
        components: ["A", "B", "C", "D"],
        lazyComponents: ["A"],
        complexity: { depth: 3, components: 10, dependencies: 20 },
        errorFilePath: "app/heavy/error.tsx",
      }),
      "/light": routeIntel("/light", {
        components: ["A"],
        complexity: { depth: 1, components: 1, dependencies: 1 },
      }),
    },
    components: { "a.tsx#A": comp("a.tsx#A", { name: "A", rendering: "client" }) },
  });
  const d = deriveMetrics(m);
  assert.equal(d.routes["/heavy"].lazyRatio, 0.25);
  assert.equal(d.routes["/heavy"].bundleRisk, 0.75);
  assert.equal(d.routes["/heavy"].hasErrorBoundary, true);
  assert.equal(d.routes["/light"].hasErrorBoundary, false);
  // /heavy must have higher complexity and therefore higher hotness in static-only mode
  assert.ok(d.routes["/heavy"].hotness > d.routes["/light"].hotness);
  assert.equal(d.hotspotRoutes[0].path, "/heavy");
});

test("deriveMetrics: confidence histogram buckets graph edges", () => {
  const m = buildManifest({
    graphEdges: [
      { source: "a", target: "b", relationship: "imports", confidence: { score: 0.95, evidence: [] } },
      { source: "a", target: "c", relationship: "imports", confidence: { score: 0.6, evidence: [] } },
      { source: "a", target: "d", relationship: "imports", confidence: { score: 0.2, evidence: [] } },
      { source: "a", target: "e", relationship: "imports" }, // no confidence — ignored
    ],
  });
  const d = deriveMetrics(m);
  assert.deepEqual(d.confidenceHistogram, { high: 1, medium: 1, low: 1 });
});

test("deriveMetrics: merges supplied bundle stats into matching routes", () => {
  const m = buildManifest({
    routes: [
      { path: "/a", filePath: "app/a/page.tsx", relativePath: "app/a/page.tsx", segmentType: "static", layoutFilePath: null, loadingFilePath: null, errorFilePath: null, templateFilePath: null, components: [], isRouteGroup: false, parentRoute: null },
    ],
    routeIntelligence: { "/a": routeIntel("/a") },
  });
  const bundle = {
    source: "test",
    totalJsBytes: 1234,
    totalCssBytes: 56,
    routes: {
      "/a": { path: "/a", jsBytes: 1234, cssBytes: 56, chunkIds: ["chunk-a.js", "chunk-a.css"] },
      "/missing": { path: "/missing", jsBytes: 1, cssBytes: 0, chunkIds: [] },
    },
  };
  const d = deriveMetrics(m, bundle);
  assert.equal(d.routes["/a"].bundle?.jsBytes, 1234);
  assert.equal(d.bundle?.routesWithStats, 1);
  assert.equal(d.bundle?.totalJsBytes, 1234);
  assert.equal(d.bundle?.source, "test");
});
