import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = resolve("dist/tools/intelligence-core/src/cli.js");

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "intelligence-json-"));
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
    `export default function HomePage() { return <main>home</main>; }\n`,
    "utf8"
  );
  return root;
}

function runCli(args, opts = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("cli --json emits a single JSON object with summary + diagnostics", { timeout: 30000 }, async () => {
  const root = await makeFixture();
  const result = await runCli(["--root", root, "--json", "--no-cache"]);

  assert.equal(result.code, 0, `CLI failed: ${result.stderr}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one JSON line, got:\n${result.stdout}`);
  const payload = JSON.parse(lines[0]);

  assert.equal(typeof payload.ok, "boolean");
  assert.equal(typeof payload.durationMs, "number");
  assert.ok(payload.summary, "summary should be present");
  assert.ok(payload.diagnostics, "diagnostics counters should be present");
  assert.equal(typeof payload.diagnostics.error, "number");
});

test("cli --json --stats includes telemetry block", { timeout: 30000 }, async () => {
  const root = await makeFixture();
  const result = await runCli(["--root", root, "--json", "--stats", "--no-cache"]);

  assert.equal(result.code, 0, `CLI failed: ${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim().split("\n").filter(Boolean)[0]);
  assert.ok(payload.telemetry, "telemetry should be included with --stats");
  assert.ok(Array.isArray(payload.telemetry.phases));
});

test("cli --json --diff yields null diff on cold run", { timeout: 30000 }, async () => {
  const root = await makeFixture();
  const result = await runCli(["--root", root, "--json", "--diff", "--no-cache"]);

  assert.equal(result.code, 0, `CLI failed: ${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim().split("\n").filter(Boolean)[0]);
  assert.equal(payload.diff, null);
});

test("cli rejects --json with --watch", { timeout: 10000 }, async () => {
  const root = await makeFixture();
  const result = await runCli(["--root", root, "--json", "--watch"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--json is not supported with --watch/);
});
