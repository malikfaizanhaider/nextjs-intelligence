import test from "node:test";
import assert from "node:assert/strict";

import { VerificationPass } from "../../dist/tools/intelligence-core/src/analyzer/index.js";

function makeComponent(id, overrides = {}) {
  return {
    identity: {
      canonicalId: id,
      sourceFile: id.split("#")[0],
      exportName: id.split("#")[1] ?? "default",
      absolutePath: `/repo/${id.split("#")[0]}`,
      compositeRoot: null,
    },
    id,
    name: overrides.name ?? id.split("#")[1] ?? id,
    filePath: `/repo/${id.split("#")[0]}`,
    relativePath: id.split("#")[0],
    type: overrides.type ?? "component",
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
    confidence: { score: 1, evidence: ["symbol-resolution"] },
    ...overrides,
  };
}

const EMPTY_GRAPHS = {
  import: { nodes: [], edges: [] },
  render: { nodes: [], edges: [] },
  compositeOwnership: { nodes: [], edges: [] },
  runtimeMount: { nodes: [], edges: [] },
};

test("verification detects duplicate canonical IDs as errors", () => {
  const components = [
    makeComponent("components/a.tsx#A", { name: "A" }),
    makeComponent("components/a.tsx#A", { name: "ADuplicate" }),
  ];

  const diagnostics = new VerificationPass().verify({
    components,
    routes: [],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites: new Map(),
  });

  const dup = diagnostics.filter((d) => d.category === "duplicate-canonical-id");
  assert.equal(dup.length, 1);
  assert.equal(dup[0].severity, "error");
});

test("verification flags unresolved JSX tags as warnings", () => {
  const components = [
    makeComponent("components/host.tsx#Host", {
      name: "Host",
      jsxChildren: ["KnownChild", "MysteryChild"],
    }),
    makeComponent("components/known.tsx#KnownChild", { name: "KnownChild" }),
  ];

  const diagnostics = new VerificationPass().verify({
    components,
    routes: [],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites: new Map(),
  });

  const unresolved = diagnostics.filter((d) => d.category === "unresolved-jsx");
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0].message, /MysteryChild/);
  assert.equal(unresolved[0].severity, "warning");
});

test("verification detects circular composite ownership", () => {
  const ownershipEdges = [
    { source: "components/a.tsx#A", target: "components/b.tsx#B", relationship: "owns" },
    { source: "components/b.tsx#B", target: "components/a.tsx#A", relationship: "owns" },
  ];

  const diagnostics = new VerificationPass().verify({
    components: [],
    routes: [],
    graphs: { ...EMPTY_GRAPHS, compositeOwnership: { nodes: [], edges: ownershipEdges } },
    unifiedGraph: { nodes: [], edges: [] },
    composites: new Map(),
  });

  const cycles = diagnostics.filter((d) => d.category === "circular-ownership");
  assert.ok(cycles.length >= 1, "expected at least one circular-ownership diagnostic");
  assert.equal(cycles[0].severity, "error");
});

test("verification reports orphan components as info-level only (not page/layout)", () => {
  const components = [
    makeComponent("components/orphan.tsx#Orphan", { name: "Orphan", type: "component" }),
    makeComponent("app/page.tsx#HomePage", { name: "HomePage", type: "page" }),
  ];

  const diagnostics = new VerificationPass().verify({
    components,
    routes: [{ path: "/", filePath: "/repo/app/page.tsx", relativePath: "app/page.tsx" }],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites: new Map(),
  });

  const orphans = diagnostics.filter((d) => d.category === "orphan-node");
  assert.ok(
    orphans.some((d) => d.message.includes("Orphan")),
    "Orphan component should be reported"
  );
  // Pages must never be reported as orphans
  assert.ok(
    !orphans.some((d) => d.message.includes("HomePage")),
    "Pages must not be reported as orphans"
  );
  for (const o of orphans) {
    assert.equal(o.severity, "info");
  }
});

test("verification emits warning for low-confidence (prefix-heuristic) composite", () => {
  const composites = new Map();
  composites.set("components/grid.tsx#DataGrid", {
    root: "DataGrid",
    rootCanonicalId: "components/grid.tsx#DataGrid",
    subComponents: ["DataGridTable"],
    subComponentIds: ["components/table.tsx#DataGridTable"],
    fullNames: ["DataGridTable"],
    confidence: { score: 0.6, evidence: ["prefix-heuristic"] },
  });

  const diagnostics = new VerificationPass().verify({
    components: [],
    routes: [],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites,
  });

  const low = diagnostics.filter((d) => d.category === "low-confidence-composite");
  assert.equal(low.length, 1);
  assert.equal(low[0].severity, "warning");
  assert.equal(low[0].nodeId, "components/grid.tsx#DataGrid");
  assert.deepEqual(low[0].relatedNodes, ["components/table.tsx#DataGridTable"]);
  assert.match(low[0].message, /DataGrid.*0\.60.*prefix-heuristic/);
  assert.match(low[0].suggestion, /Object\.assign/);
  assert.equal(low[0].context.confidence, 0.6);
});

test("verification emits info for single-semantic-signal composite (score 0.7-0.85)", () => {
  const composites = new Map();
  composites.set("components/tabs.tsx#Tabs", {
    root: "Tabs",
    rootCanonicalId: "components/tabs.tsx#Tabs",
    subComponents: ["Panel"],
    subComponentIds: ["components/tabs.tsx#Panel"],
    fullNames: ["Tabs.Panel"],
    confidence: { score: 0.8, evidence: ["dotted-jsx"] },
  });

  const diagnostics = new VerificationPass().verify({
    components: [],
    routes: [],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites,
  });

  const low = diagnostics.filter((d) => d.category === "low-confidence-composite");
  assert.equal(low.length, 1);
  assert.equal(low[0].severity, "info");
  assert.match(low[0].suggestion, /second semantic signal/);
});

test("verification stays silent for high-confidence composites (>= 0.85)", () => {
  const composites = new Map();
  composites.set("components/menu.tsx#Menu", {
    root: "Menu",
    rootCanonicalId: "components/menu.tsx#Menu",
    subComponents: ["Item"],
    subComponentIds: ["components/menu.tsx#Item"],
    fullNames: ["Menu.Item"],
    confidence: { score: 0.95, evidence: ["object-assign", "dotted-jsx"] },
  });

  const diagnostics = new VerificationPass().verify({
    components: [],
    routes: [],
    graphs: EMPTY_GRAPHS,
    unifiedGraph: { nodes: [], edges: [] },
    composites,
  });

  assert.equal(
    diagnostics.filter((d) => d.category === "low-confidence-composite").length,
    0
  );
});
