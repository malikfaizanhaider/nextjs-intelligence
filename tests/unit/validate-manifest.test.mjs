import test from "node:test";
import assert from "node:assert/strict";

import {
  validateManifest,
  assertManifest,
  MANIFEST_SCHEMA_VERSION,
} from "../../dist/tools/intelligence-types/src/index.js";

const VALID_MANIFEST = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  generatedAt: "2026-01-01T00:00:00.000Z",
  projectRoot: "/repo",
  summary: {
    screens: 0,
    components: 0,
    reusableComponents: 0,
    dialogs: 0,
    grids: 0,
    charts: 0,
    providers: 0,
    layouts: 0,
    pages: 0,
    hooks: 0,
    utils: 0,
    clientComponents: 0,
    serverComponents: 0,
    avgComplexity: 0,
    maxComplexity: 0,
    apiRoutes: 0,
    middlewareCount: 0,
    parallelSlots: 0,
    serverActions: 0,
  },
  routes: [],
  routeIntelligence: {},
  components: {},
  componentUsage: {},
  graph: { nodes: [], edges: [] },
  graphs: {
    import: { nodes: [], edges: [] },
    render: { nodes: [], edges: [] },
    compositeOwnership: { nodes: [], edges: [] },
    runtimeMount: { nodes: [], edges: [] },
  },
  runtime: {},
  diagnostics: [],
  apiRoutes: [],
  middleware: [],
  parallelSlots: [],
  serverActions: [],
};

test("validateManifest accepts a well-formed manifest", () => {
  const result = validateManifest(VALID_MANIFEST);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateManifest rejects non-object inputs", () => {
  assert.equal(validateManifest(null).valid, false);
  assert.equal(validateManifest("not a manifest").valid, false);
  assert.equal(validateManifest(["array"]).valid, false);
});

test("validateManifest reports missing top-level fields", () => {
  const { generatedAt: _, ...partial } = VALID_MANIFEST;
  const result = validateManifest(partial);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("generatedAt")));
});

test("validateManifest reports malformed nested graph shapes", () => {
  const broken = { ...VALID_MANIFEST, graph: { nodes: "oops" } };
  const result = validateManifest(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("graph.nodes")));
  assert.ok(result.errors.some((e) => e.includes("graph.edges")));
});

test("validateManifest reports malformed separated graphs", () => {
  const broken = {
    ...VALID_MANIFEST,
    graphs: { ...VALID_MANIFEST.graphs, render: { nodes: [] } },
  };
  const result = validateManifest(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("graphs.render.edges")));
});

test("assertManifest throws on invalid input and passes on valid", () => {
  assert.throws(() => assertManifest({}), /Invalid IntelligenceManifest/);
  assert.doesNotThrow(() => assertManifest(VALID_MANIFEST));
});

test("validateManifest rejects missing schemaVersion", () => {
  const { schemaVersion: _, ...partial } = VALID_MANIFEST;
  const result = validateManifest(partial);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("schemaVersion")));
});

test("validateManifest rejects malformed schemaVersion", () => {
  const result = validateManifest({ ...VALID_MANIFEST, schemaVersion: "v1" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /semver/.test(e)));
});

test("validateManifest rejects mismatched major schemaVersion", () => {
  const currentMajor = Number(MANIFEST_SCHEMA_VERSION.split(".")[0]);
  const futureMajor = `${currentMajor + 1}.0.0`;
  const result = validateManifest({ ...VALID_MANIFEST, schemaVersion: futureMajor });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("major mismatch")));
});

test("validateManifest accepts compatible minor/patch bumps within same major", () => {
  const sameMajorBump = `${MANIFEST_SCHEMA_VERSION.split(".")[0]}.99.99`;
  const result = validateManifest({ ...VALID_MANIFEST, schemaVersion: sameMajorBump });
  assert.equal(result.valid, true);
});
