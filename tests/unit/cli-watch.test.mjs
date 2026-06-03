import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = resolve("dist/tools/intelligence-core/src/cli.js");

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "intelligence-watch-"));
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

// ----------------------------------------------------------------------------
// Smoke test for `--watch`: spawn the CLI, wait for the initial "Done."
// banner, modify a file, then assert that the watcher logs a `[watch] rebuilt`
// line within a generous window. Verifies the watcher → debouncer → runOnce
// wiring end-to-end without re-testing the pipeline itself.
// ----------------------------------------------------------------------------

test("cli --watch rebuilds on file change", { timeout: 15000 }, async () => {
  const root = await makeFixture();
  // Aggregate stdout so the test can assert on multi-line phrases without
  // racing the chunk boundaries.
  let buffer = "";
  const child = spawn(
    process.execPath,
    [CLI_PATH, "--root", root, "--watch", "--watch-debounce", "50"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  /** Wait until `buffer` contains `needle`, or fail after `timeoutMs`. */
  const waitFor = (needle, timeoutMs) =>
    new Promise((resolveWait, rejectWait) => {
      const start = Date.now();
      const tick = () => {
        if (buffer.includes(needle)) return resolveWait();
        if (Date.now() - start > timeoutMs) {
          return rejectWait(
            new Error(
              `Timed out waiting for "${needle}" after ${timeoutMs}ms.\n--- captured output ---\n${buffer}`
            )
          );
        }
        setTimeout(tick, 50);
      };
      tick();
    });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    buffer += chunk.toString();
  });

  try {
    // First cold run + watcher start-up. `--quiet` suppresses phase logs but
    // the watcher's own banner and `[watch] rebuilt` lines still go to
    // stdout via consoleLogger.info (NOT through silentLogger).
    //
    // Wait for the explicit watcher-ready banner before mutating the FS.
    await waitFor("[watch] watching for changes", 10000);

    // Modify page.tsx to force a rebuild.
    await writeFile(
      join(root, "app/page.tsx"),
      `export default function HomePage() { return <main>home v2</main>; }\n`,
      "utf8"
    );

    // Expect the watcher to log a rebuild within 8s (covers debounce +
    // full pipeline run on a tiny fixture).
    await waitFor("[watch] rebuilt", 8000);
  } finally {
    child.kill("SIGTERM");
    // Drain the exit event so the test runner doesn't see a stray "process
    // still alive" warning. SIGTERM may not exit synchronously on Windows.
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(r, 1000); // hard cap
    });
    await rm(root, { recursive: true, force: true });
  }

  assert.match(
    buffer,
    /\[watch\] rebuilt in \d+ms/,
    "watcher should log rebuild duration"
  );
});
