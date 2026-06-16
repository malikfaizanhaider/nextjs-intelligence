import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";
import {
  MANIFEST_SCHEMA_VERSION,
  buildCanonicalId,
} from "../../dist/tools/intelligence-types/src/index.js";

/**
 * A fixture exercising every supported declaration kind plus the identity
 * edge cases the Symbol Inventory must handle (named default export, anonymous
 * default export, value/type name collision, non-exported locals).
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
        include: ["app/**/*", "lib/**/*", "components/**/*"],
      },
      null,
      2
    ),

    // Root page so route detection has something to chew on.
    "app/page.tsx":
      `import { Card } from "../components/card";\n` +
      `export default function HomePage() {\n` +
      `  return <Card />;\n` +
      `}\n`,

    // A component file (its export should be cross-linked isComponent: true).
    "components/card.tsx":
      `export function Card() {\n` +
      `  return <div className="card" />;\n` +
      `}\n`,

    // Every supported kind + a non-exported local that must be skipped.
    "lib/kinds.ts":
      `export function namedFn() { return 1; }\n` +
      `export class NamedClass {}\n` +
      `export interface NamedInterface { a: number; }\n` +
      `export type NamedType = string;\n` +
      `export enum NamedEnum { A, B }\n` +
      `export const namedConst = 42;\n` +
      `function localOnly() { return 2; }\n`,

    // Named default export — identity should use the declared name.
    "lib/named-default.ts":
      `export default function NamedDefault() { return 3; }\n`,

    // Anonymous default export — identity should fall back to "default".
    "lib/anon-default.ts": `export default function () { return 4; }\n`,

    // Value/type collision: value (const) must win the canonical id.
    "lib/collision.ts":
      `export type Conflict = { kind: "type" };\n` +
      `export const Conflict = { kind: "value" };\n`,
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
      include: [
        "app/**/*.{tsx,ts}",
        "components/**/*.{tsx,ts}",
        "lib/**/*.{tsx,ts}",
      ],
    },
    { logger: silentLogger }
  );
}

test("symbol inventory: collects every supported declaration kind", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-kinds-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const symbols = manifest.symbols;

    const byId = (rel, name) => symbols[buildCanonicalId(rel, name)];

    assert.equal(byId("lib/kinds.ts", "namedFn")?.kind, "function");
    assert.equal(byId("lib/kinds.ts", "NamedClass")?.kind, "class");
    assert.equal(byId("lib/kinds.ts", "NamedInterface")?.kind, "interface");
    assert.equal(byId("lib/kinds.ts", "NamedType")?.kind, "type");
    assert.equal(byId("lib/kinds.ts", "NamedEnum")?.kind, "enum");
    assert.equal(byId("lib/kinds.ts", "namedConst")?.kind, "const");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: skips non-exported local declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-local-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    assert.equal(manifest.symbols[buildCanonicalId("lib/kinds.ts", "localOnly")], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: SymbolMeta records the required descriptive fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-schema-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const meta = manifest.symbols[buildCanonicalId("lib/kinds.ts", "namedFn")];

    assert.ok(meta, "expected namedFn symbol to be present");
    assert.equal(meta.canonicalId, "lib/kinds.ts#namedFn");
    assert.equal(meta.relativePath, "lib/kinds.ts");
    assert.equal(meta.exportName, "namedFn");
    assert.equal(meta.kind, "function");
    assert.equal(meta.exportType, "named");
    assert.equal(typeof meta.line, "number");
    assert.ok(meta.line >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: named default export keeps its declared name", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-named-default-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const meta = manifest.symbols[buildCanonicalId("lib/named-default.ts", "NamedDefault")];

    assert.ok(meta, "expected named default export to be present");
    assert.equal(meta.exportType, "default");
    assert.equal(meta.kind, "function");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: anonymous default export falls back to #default", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-anon-default-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const meta = manifest.symbols[buildCanonicalId("lib/anon-default.ts", "default")];

    assert.ok(meta, "expected anonymous default export to be present");
    assert.equal(meta.exportName, "default");
    assert.equal(meta.exportType, "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: value wins a value/type name collision (first-wins)", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-collision-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const meta = manifest.symbols[buildCanonicalId("lib/collision.ts", "Conflict")];

    assert.ok(meta, "expected a single Conflict entry");
    assert.equal(meta.kind, "const");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: cross-links isComponent for classified components", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-iscomponent-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);

    const cardId = buildCanonicalId("components/card.tsx", "Card");
    const card = manifest.symbols[cardId];
    assert.ok(card, "expected Card symbol to be present");
    assert.equal(card.isComponent, true);
    assert.ok(manifest.components[cardId], "Card should also be a component");

    // A plain library function is not a component.
    const fn = manifest.symbols[buildCanonicalId("lib/kinds.ts", "namedFn")];
    assert.notEqual(fn.isComponent, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: manifest advertises schema 1.3.0", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-version-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
    assert.equal(MANIFEST_SCHEMA_VERSION, "1.3.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: symbols.json projection equals manifest.symbols", async () => {
  const root = await mkdtemp(join(tmpdir(), "symbol-projection-"));
  try {
    await writeFixture(root);
    const { manifest } = await runPipeline(root);
    const onDisk = JSON.parse(
      await readFile(join(root, ".generated/intelligence/symbols.json"), "utf8")
    );
    assert.deepEqual(onDisk, manifest.symbols);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symbol inventory: symbols.json is byte-identical across runs (determinism)", async () => {
  const rootA = await mkdtemp(join(tmpdir(), "symbol-det-a-"));
  const rootB = await mkdtemp(join(tmpdir(), "symbol-det-b-"));
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
