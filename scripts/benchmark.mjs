#!/usr/bin/env node
/**
 * Phase B6 — micro-benchmark for the intelligence pipeline.
 *
 * Generates a synthetic Next.js app under a temp directory:
 *   - N routes (default 30)
 *   - M shared client components per route (default 8)
 *   - Each route imports the SAME shared components (so the per-file
 *     traversal cache from B3 should land most lookups as hits)
 *
 * Then runs the pipeline once and prints:
 *   - total duration
 *   - per-phase durations
 *   - traversal cache hit rate (proving the Phase B3 shared cache is active)
 *
 * Usage:
 *   node scripts/benchmark.mjs              # defaults
 *   node scripts/benchmark.mjs 50 12        # 50 routes, 12 shared components
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTES = Number(process.argv[2] ?? 30);
const SHARED = Number(process.argv[3] ?? 8);

const { runIntelligencePipelineDetailed, silentLogger } = await import(
  "../dist/tools/intelligence-core/src/index.js"
);

async function generateFixture(root) {
  await mkdir(join(root, "app"), { recursive: true });
  await mkdir(join(root, "components"), { recursive: true });

  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          jsx: "preserve",
          strict: false,
          moduleResolution: "node",
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
        include: ["app", "components"],
      },
      null,
      2
    )
  );

  await writeFile(
    join(root, "app/layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`
  );

  // M shared components
  for (let c = 0; c < SHARED; c++) {
    await writeFile(
      join(root, `components/Shared${c}.tsx`),
      `"use client";
import { useState } from "react";
export function Shared${c}() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>shared-${c} {n}</button>;
}
`
    );
  }

  // N routes, each importing every Shared component
  for (let r = 0; r < ROUTES; r++) {
    const dir = join(root, "app", `route${r}`);
    await mkdir(dir, { recursive: true });
    const imports = Array.from({ length: SHARED }, (_, c) =>
      `import { Shared${c} } from "@/components/Shared${c}";`
    ).join("\n");
    const usages = Array.from({ length: SHARED }, (_, c) => `<Shared${c} />`).join("\n      ");
    await writeFile(
      join(dir, "page.tsx"),
      `${imports}
export default function Route${r}Page() {
  return (
    <main>
      ${usages}
    </main>
  );
}
`
    );
  }
}

function formatMs(ms) {
  return `${ms.toFixed(1).padStart(8)} ms`;
}

async function main() {
  const root = join(tmpdir(), `intelligence-bench-${Date.now()}`);
  console.log(`Generating fixture: ${ROUTES} routes × ${SHARED} shared components at ${root}`);
  await generateFixture(root);

  console.log(`\nRunning pipeline…\n`);
  const start = Date.now();
  const { manifest, telemetry } = await runIntelligencePipelineDetailed(
    {
      projectRoot: root,
      outputDir: join(root, ".generated"),
      includeNestedGraphs: false,
    },
    { logger: silentLogger }
  );
  const wallMs = Date.now() - start;

  console.log("Phase timings:");
  for (const phase of telemetry.phases) {
    const counts = phase.counts
      ? "  " + Object.entries(phase.counts).map(([k, v]) => `${k}=${v}`).join(" ")
      : "";
    console.log(`  ${phase.name.padEnd(20)} ${formatMs(phase.durationMs)}${counts}`);
  }

  const phase5 = telemetry.phases.find((p) => p.name === "route-intelligence");
  const hits = phase5?.counts?.traversalCacheHits ?? 0;
  const misses = phase5?.counts?.traversalCacheMisses ?? 0;
  const hitRate =
    hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : "n/a";

  console.log("\nSummary:");
  console.log(`  Routes analyzed       : ${Object.keys(manifest.routes).length}`);
  console.log(`  Components discovered : ${Object.keys(manifest.components).length}`);
  console.log(`  Parse attempted       : ${telemetry.parse.attempted}`);
  console.log(`  Parse failed          : ${telemetry.parse.failed}`);
  console.log(`  Traversal cache       : ${hits} hits / ${misses} misses (${hitRate}% hit rate)`);
  console.log(`  Total pipeline time   : ${telemetry.totalDurationMs.toFixed(1)} ms`);
  console.log(`  Wall-clock incl. I/O  : ${wallMs} ms`);

  await rm(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
