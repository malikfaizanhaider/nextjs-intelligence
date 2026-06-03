import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Project } from "ts-morph";

import { SearchParamsAnalyzer } from "../../dist/tools/intelligence-core/src/index.js";

/**
 * Phase C5 — AST-based SearchParamsAnalyzer.
 * These tests exercise patterns that the previous regex implementation
 * either over- or under-counted: nested destructuring, useSearchParams()
 * bindings, ternaries, optional chaining, element access.
 */

async function setupProject(files) {
  const root = await mkdtemp(join(tmpdir(), "intelligence-sp-"));
  const project = new Project({
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
      jsx: 1,     // Preserve
      moduleResolution: 100, // Bundler
      strict: false,
      allowJs: true,
      noEmit: true,
      esModuleInterop: true,
      skipLibCheck: true,
      baseUrl: root,
    },
  });
  const written = [];
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, contents, "utf8");
    project.addSourceFileAtPath(abs);
    written.push(abs);
  }
  return { root, project, files: written, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("Phase C5: AST analyzer captures server searchParams via destructuring", async () => {
  const ctx = await setupProject({
    "app/page.tsx":
      `export default function Page({ searchParams }: any) {\n` +
      `  const page = searchParams.page;\n` +
      `  const tab = searchParams["tab"];\n` +
      `  return <div>{page}{tab}</div>;\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    const keys = Array.from(result.searchParams.keys()).sort();
    assert.deepEqual(keys, ["page", "tab"]);
    for (const key of keys) {
      assert.equal(result.searchParams.get(key).accessPattern, "searchParams");
    }
  } finally {
    await ctx.cleanup();
  }
});

test("Phase C5: nested destructuring in props captures inner keys", async () => {
  const ctx = await setupProject({
    "app/page.tsx":
      `export default function Page({ searchParams: { q, sort }, params: { id, slug } }: any) {\n` +
      `  return <div>{q}{sort}{id}{slug}</div>;\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    assert.deepEqual(Array.from(result.searchParams.keys()).sort(), ["q", "sort"]);
    assert.deepEqual(result.dynamicParams.sort(), ["id", "slug"]);
  } finally {
    await ctx.cleanup();
  }
});

test("Phase C5: useSearchParams().get(\"x\") is captured; bare property access is not", async () => {
  const ctx = await setupProject({
    "app/client.tsx":
      `"use client";\n` +
      `import { useSearchParams } from "next/navigation";\n` +
      `export default function ClientPage() {\n` +
      `  const sp = useSearchParams();\n` +
      `  const page = sp.get("page");\n` +
      `  const filter = sp.getAll("filter");\n` +
      `  const has = sp.has("debug");\n` +
      `  void sp.entries; // not a tracked key\n` +
      `  return <div>{page}{filter}{has}</div>;\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    const keys = Array.from(result.searchParams.keys()).sort();
    assert.deepEqual(keys, ["debug", "filter", "page"]);
    for (const key of keys) {
      assert.equal(result.searchParams.get(key).accessPattern, "useSearchParams");
    }
  } finally {
    await ctx.cleanup();
  }
});

test("Phase C5: optional chaining and conditional access still register", async () => {
  const ctx = await setupProject({
    "app/page.tsx":
      `export default function Page({ searchParams }: any) {\n` +
      `  const v = searchParams?.view ?? "list";\n` +
      `  const x = true ? searchParams.alpha : searchParams.beta;\n` +
      `  return <div>{v}{x}</div>;\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    assert.deepEqual(
      Array.from(result.searchParams.keys()).sort(),
      ["alpha", "beta", "view"]
    );
  } finally {
    await ctx.cleanup();
  }
});

test("Phase C5: shadowed identifier does not pollute results", async () => {
  // `searchParams` declared locally without binding to a Next prop must not
  // produce false positives. The AST analyzer only tracks identifiers it has
  // bound from a function parameter or `useSearchParams()` call.
  const ctx = await setupProject({
    "app/util.tsx":
      `export function makeURL(input: string) {\n` +
      `  const searchParams = new URLSearchParams(input);\n` +
      `  return searchParams.toString();\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    assert.equal(result.searchParams.size, 0);
  } finally {
    await ctx.cleanup();
  }
});

test("Phase C5: useParams() destructuring populates dynamicParams", async () => {
  const ctx = await setupProject({
    "app/client.tsx":
      `"use client";\n` +
      `import { useParams } from "next/navigation";\n` +
      `export default function ClientPage() {\n` +
      `  const { id, slug } = useParams();\n` +
      `  return <div>{id}{slug}</div>;\n` +
      `}\n`,
  });
  try {
    const analyzer = new SearchParamsAnalyzer(ctx.project, ctx.root);
    const result = analyzer.analyzeFiles(ctx.files);
    assert.deepEqual(result.dynamicParams.sort(), ["id", "slug"]);
  } finally {
    await ctx.cleanup();
  }
});
