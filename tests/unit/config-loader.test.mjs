import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadConfigFile,
  mergeConfigs,
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "intelligence-config-"));
}

test("Phase E4: loadConfigFile returns empty config when no file exists", async () => {
  const root = await makeRoot();
  try {
    const result = await loadConfigFile(root);
    assert.deepEqual(result.config, {});
    assert.equal(result.filePath, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase E4: loadConfigFile reads .intelligencerc.json", async () => {
  const root = await makeRoot();
  try {
    await writeFile(
      join(root, ".intelligencerc.json"),
      JSON.stringify({
        outputDir: "build/intel",
        incremental: false,
        include: ["custom/**/*.tsx"],
      }),
      "utf8"
    );
    const result = await loadConfigFile(root);
    assert.equal(result.filePath, join(root, ".intelligencerc.json"));
    assert.equal(result.config.outputDir, "build/intel");
    assert.equal(result.config.incremental, false);
    assert.deepEqual(result.config.include, ["custom/**/*.tsx"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase E4: loadConfigFile reads intelligence.config.mjs default export", async () => {
  const root = await makeRoot();
  try {
    await writeFile(
      join(root, "intelligence.config.mjs"),
      `export default { outputDir: "out/intel", appDir: "src/app" };\n`,
      "utf8"
    );
    const result = await loadConfigFile(root);
    assert.equal(result.filePath, join(root, "intelligence.config.mjs"));
    assert.equal(result.config.outputDir, "out/intel");
    assert.equal(result.config.appDir, "src/app");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase E4: invalid JSON throws a helpful error", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, ".intelligencerc.json"), "{ not json", "utf8");
    await assert.rejects(
      () => loadConfigFile(root),
      /Failed to parse config file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase E4: mergeConfigs lets user partial win over loaded values", () => {
  const merged = mergeConfigs(
    { outputDir: "from-file", incremental: false, include: ["a/**/*"] },
    { outputDir: "from-cli" }
  );
  assert.equal(merged.outputDir, "from-cli", "user partial must win");
  assert.equal(merged.incremental, false, "loaded value preserved when user is silent");
  assert.deepEqual(merged.include, ["a/**/*"]);
});

test("Phase E4: pipeline auto-loads .intelligencerc.json and honours it", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-config-e2e-"));
  try {
    // Minimal Next.js fixture so the pipeline succeeds.
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          jsx: "preserve",
          moduleResolution: "Bundler",
          strict: false,
          allowJs: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: ".",
        },
        include: ["app/**/*"],
      })
    );
    await writeFile(
      join(root, "app/page.tsx"),
      `export default function HomePage() { return <main />; }\n`,
      "utf8"
    );

    // Config file places output under a custom directory.
    await writeFile(
      join(root, ".intelligencerc.json"),
      JSON.stringify({ outputDir: "custom-out/intel", incremental: false }),
      "utf8"
    );

    const { manifest } = await runIntelligencePipelineDetailed(
      { projectRoot: root },
      { logger: silentLogger }
    );

    // The manifest itself doesn't expose `config.outputDir`, but the
    // output-writer would have written to `custom-out/intel`. Confirm a
    // file landed there.
    const { stat } = await import("node:fs/promises");
    const manifestPath = join(root, "custom-out/intel/manifest.json");
    const info = await stat(manifestPath);
    assert.ok(info.isFile(), "expected manifest at config-derived output path");
    assert.ok(manifest.routes.length >= 1, "pipeline still produced routes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase E4: skipConfigFile bypasses on-disk config", async () => {
  const root = await mkdtemp(join(tmpdir(), "intelligence-config-skip-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          jsx: "preserve",
          moduleResolution: "Bundler",
          strict: false,
          allowJs: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: ".",
        },
        include: ["app/**/*"],
      })
    );
    await writeFile(
      join(root, "app/page.tsx"),
      `export default function HomePage() { return <main />; }\n`,
      "utf8"
    );
    await writeFile(
      join(root, ".intelligencerc.json"),
      JSON.stringify({ outputDir: "ignored-out/intel" }),
      "utf8"
    );

    await runIntelligencePipelineDetailed(
      { projectRoot: root, outputDir: "wins/intel", incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );

    const { stat } = await import("node:fs/promises");
    const wins = await stat(join(root, "wins/intel/manifest.json"));
    assert.ok(wins.isFile(), "user outputDir should be used");

    await assert.rejects(() => stat(join(root, "ignored-out/intel/manifest.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
