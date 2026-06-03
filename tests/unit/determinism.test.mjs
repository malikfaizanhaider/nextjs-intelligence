import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runIntelligencePipelineDetailed,
  silentLogger,
} from "../../dist/tools/intelligence-core/src/index.js";

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "intelligence-determinism-"));
  await mkdir(join(root, "app/about"), { recursive: true });
  await mkdir(join(root, "app/blog/[slug]"), { recursive: true });
  await mkdir(join(root, "components"), { recursive: true });
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
      include: ["app/**/*", "components/**/*"],
    })
  );
  await writeFile(
    join(root, "components/Button.tsx"),
    `export function Button({ children }) { return <button>{children}</button>; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "components/Card.tsx"),
    `import { Button } from "./Button";\nexport function Card() { return <div><Button>OK</Button></div>; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "app/page.tsx"),
    `import { Card } from "../components/Card";\nexport default function HomePage() { return <Card />; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "app/about/page.tsx"),
    `export default function AboutPage() { return <section>about</section>; }\n`,
    "utf8"
  );
  await writeFile(
    join(root, "app/blog/[slug]/page.tsx"),
    `export default function BlogPost({ params }) { return <article>{params.slug}</article>; }\n`,
    "utf8"
  );
  return root;
}

// ----------------------------------------------------------------------------
// Determinism guarantee: two independent pipeline runs over the same source
// tree must produce byte-identical manifests. This is the user-facing promise
// underpinning incremental builds, caching, and content-addressed artifacts.
// Any non-determinism (Map iteration order, Date.now() in manifest payload,
// unsorted arrays, etc.) will be caught here.
// ----------------------------------------------------------------------------

/**
 * Strip the only known non-deterministic field — `generatedAt`, an ISO
 * timestamp captured at export time — so the rest of the manifest can be
 * compared byte-for-byte. If the test ever needs to assert on timestamps
 * specifically, do it in a separate test.
 */
function stripVolatile(manifest) {
  // eslint-disable-next-line no-unused-vars
  const { generatedAt, ...rest } = manifest;
  return rest;
}

test("determinism: two cold runs over the same fixture produce identical manifests", async () => {
  const rootA = await makeFixture();
  const rootB = await makeFixture();
  try {
    const a = await runIntelligencePipelineDetailed(
      { projectRoot: rootA, incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );
    const b = await runIntelligencePipelineDetailed(
      { projectRoot: rootB, incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );

    // `projectRoot` differs between the two tmpdirs and leaks into absolute
    // paths inside the manifest; normalize before comparison.
    const normalize = (m) =>
      JSON.parse(
        JSON.stringify(stripVolatile(m))
          .split(rootA.replace(/\\/g, "\\\\"))
          .join("<ROOT>")
          .split(rootA.replace(/\\/g, "/"))
          .join("<ROOT>")
          .split(rootB.replace(/\\/g, "\\\\"))
          .join("<ROOT>")
          .split(rootB.replace(/\\/g, "/"))
          .join("<ROOT>")
      );

    const aNorm = normalize(a.manifest);
    const bNorm = normalize(b.manifest);
    assert.deepStrictEqual(
      aNorm,
      bNorm,
      "manifest payload must be identical across independent runs"
    );
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});

test("determinism: re-running on the same root produces byte-identical manifest.json on disk", async () => {
  const root = await makeFixture();
  try {
    // First run: writes manifest.json.
    await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );
    const manifestPath = join(root, ".generated/intelligence/manifest.json");
    const firstBytes = await readFile(manifestPath, "utf-8");
    const firstParsed = JSON.parse(firstBytes);

    // Second run (also non-incremental, so it actually re-executes).
    await runIntelligencePipelineDetailed(
      { projectRoot: root, incremental: false },
      { logger: silentLogger, skipConfigFile: true }
    );
    const secondBytes = await readFile(manifestPath, "utf-8");
    const secondParsed = JSON.parse(secondBytes);

    // Everything except `generatedAt` must be byte-identical. Compare the
    // parsed JSON minus the timestamp; this catches ordering drift without
    // false positives on the timestamp itself.
    assert.deepStrictEqual(
      stripVolatile(secondParsed),
      stripVolatile(firstParsed),
      "manifest.json contents must be identical across re-runs"
    );

    // And the serialized form (minus the timestamp line) should match too —
    // this catches whitespace / key-ordering changes that deepStrictEqual
    // would silently accept.
    const stripTs = (s) => s.replace(/"generatedAt":\s*"[^"]+",?\s*/g, "");
    assert.equal(
      stripTs(secondBytes),
      stripTs(firstBytes),
      "manifest.json serialized bytes must match (modulo generatedAt)"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
