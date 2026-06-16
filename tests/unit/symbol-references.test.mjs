import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";
import { buildCanonicalId } from "../../dist/tools/intelligence-types/src/index.js";

/**
 * A fixture exercising the reference resolution cases the simplified V2 model
 * must handle: local, import, aliased import, re-export/barrel, type position,
 * value position, self-reference, non-exported local target, node_modules
 * target, and namespace-member access (non-goal).
 */
async function writeFixture(root) {
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
        include: ["lib/**/*.{tsx,ts}"],
      },
      null,
      2
    ),

    // Base declarations that others reference.
    "lib/base.ts":
      `export function helper() { return 1; }\n` +
      `export interface Shape { kind: string; }\n` +
      `export const CONSTANT = 7;\n`,

    // Barrel that re-exports helper.
    "lib/barrel.ts": `export { helper } from "./base";\n`,

    // value reference (direct local-module import) + type reference.
    "lib/consumer.ts":
      `import { helper, CONSTANT } from "./base";\n` +
      `import type { Shape } from "./base";\n` +
      `export function useHelper(s: Shape) {\n` +
      `  return helper() + CONSTANT + (s.kind.length);\n` +
      `}\n`,

    // Aliased import of helper.
    "lib/aliased.ts":
      `import { helper as aid } from "./base";\n` +
      `export function viaAlias() { return aid(); }\n`,

    // Reference through the barrel re-export — must resolve to base#helper.
    "lib/reexport-consumer.ts":
      `import { helper } from "./barrel";\n` +
      `export function viaBarrel() { return helper(); }\n`,

    // Self-reference (recursion) must NOT create an edge.
    "lib/recursive.ts":
      `export function countdown(n: number): number {\n` +
      `  return n <= 0 ? 0 : countdown(n - 1);\n` +
      `}\n`,

    // Reference to a non-exported local — must NOT create an edge.
    "lib/local-only.ts":
      `function secret() { return 42; }\n` +
      `export function usesSecret() { return secret(); }\n`,

    // node_modules-style target — must NOT create an edge.
    "lib/external.ts":
      `import { join } from "node:path";\n` +
      `export function usesExternal() { return join("a", "b"); }\n`,

    // Multiple uses of the same target collapse to a single edge.
    "lib/multi.ts":
      `import { helper } from "./base";\n` +
      `export function usesTwice() { return helper() + helper(); }\n`,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
}

async function runPipeline(root) {
  return runIntelligencePipelineDetailed(
    {
      projectRoot: root,
      outputDir: join(root, ".generated/intelligence"),
      cacheDir: join(root, ".cache/intelligence"),
      incremental: false,
      include: ["lib/**/*.{tsx,ts}"],
    },
    { logger: silentLogger }
  );
}

const HELPER = buildCanonicalId("lib/base.ts", "helper");
const SHAPE = buildCanonicalId("lib/base.ts", "Shape");
const CONSTANT = buildCanonicalId("lib/base.ts", "CONSTANT");

test("references: resolves a direct value import to the original symbol", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-import-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/consumer.ts", "useHelper")].references;
    assert.ok(refs.includes(HELPER));
    assert.ok(refs.includes(CONSTANT));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: resolves a type-position reference to the type's symbol", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-type-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/consumer.ts", "useHelper")].references;
    assert.ok(refs.includes(SHAPE));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: aliased import resolves to the original declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-alias-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/aliased.ts", "viaAlias")].references;
    assert.deepEqual(refs, [HELPER]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: re-export/barrel resolves to the original, not the barrel", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-barrel-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/reexport-consumer.ts", "viaBarrel")].references;
    assert.ok(refs.includes(HELPER));
    assert.ok(!refs.includes(buildCanonicalId("lib/barrel.ts", "helper")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: self-references are excluded", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-self-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const id = buildCanonicalId("lib/recursive.ts", "countdown");
    assert.deepEqual(manifest.symbols[id].references, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: non-exported local targets are excluded", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-local-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/local-only.ts", "usesSecret")].references;
    assert.deepEqual(refs, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: node_modules targets are excluded", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-external-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/external.ts", "usesExternal")].references;
    assert.deepEqual(refs, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: repeated uses collapse to a single deduplicated edge", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-multi-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const refs = manifest.symbols[buildCanonicalId("lib/multi.ts", "usesTwice")].references;
    assert.deepEqual(refs, [HELPER]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: arrays are sorted ascending and deduplicated", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-sorted-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    for (const meta of Object.values(manifest.symbols)) {
      for (const arr of [meta.references ?? [], meta.referencedBy ?? []]) {
        const sorted = [...arr].sort();
        assert.deepEqual(arr, sorted, "array must be sorted ascending");
        assert.equal(new Set(arr).size, arr.length, "array must be deduplicated");
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("referencedBy: is the exact inverse of references", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-inverse-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const symbols = manifest.symbols;

    // Forward edges → expected inverse set.
    const expected = new Map();
    for (const [sourceId, meta] of Object.entries(symbols)) {
      for (const target of meta.references ?? []) {
        if (!expected.has(target)) expected.set(target, new Set());
        expected.get(target).add(sourceId);
      }
    }

    for (const [id, meta] of Object.entries(symbols)) {
      const actual = new Set(meta.referencedBy ?? []);
      const want = expected.get(id) ?? new Set();
      assert.deepEqual([...actual].sort(), [...want].sort());
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("referencedBy: every endpoint is a key in manifest.symbols (integrity)", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-integrity-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const keys = new Set(Object.keys(manifest.symbols));
    for (const meta of Object.values(manifest.symbols)) {
      for (const id of meta.references ?? []) assert.ok(keys.has(id), `dangling reference: ${id}`);
      for (const id of meta.referencedBy ?? []) assert.ok(keys.has(id), `dangling referencedBy: ${id}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: helper is referenced by all its consumers (Who uses X?)", async () => {
  const root = await mkdtemp(join(tmpdir(), "ref-whouses-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const back = new Set(manifest.symbols[HELPER].referencedBy);
    assert.ok(back.has(buildCanonicalId("lib/consumer.ts", "useHelper")));
    assert.ok(back.has(buildCanonicalId("lib/aliased.ts", "viaAlias")));
    assert.ok(back.has(buildCanonicalId("lib/reexport-consumer.ts", "viaBarrel")));
    assert.ok(back.has(buildCanonicalId("lib/multi.ts", "usesTwice")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("references: symbols.json is byte-identical across runs (determinism)", async () => {
  const rootA = await mkdtemp(join(tmpdir(), "ref-det-a-"));
  const rootB = await mkdtemp(join(tmpdir(), "ref-det-b-"));
  try {
    await writeFixture(rootA);
    await writeFixture(rootB);
    await runPipeline(rootA);
    await runPipeline(rootB);
    const a = await readFile(join(rootA, ".generated/intelligence/symbols.json"), "utf8");
    const b = await readFile(join(rootB, ".generated/intelligence/symbols.json"), "utf8");
    assert.equal(a, b);
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});
