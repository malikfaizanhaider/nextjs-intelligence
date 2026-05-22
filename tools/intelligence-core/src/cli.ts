#!/usr/bin/env node

import { resolve } from "node:path";
import { runIntelligencePipeline } from "./pipeline";

const args = process.argv.slice(2);

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(args);

  const projectRoot = parsed["root"] ? resolve(parsed["root"]) : process.cwd();
  const outputDir = parsed["output"] ?? ".generated/intelligence";
  const appDir = parsed["app-dir"] ?? "app";
  const incremental = parsed["no-cache"] !== "true";

  console.log(`[intelligence] Project root: ${projectRoot}`);
  console.log(`[intelligence] App directory: ${appDir}`);
  console.log(`[intelligence] Output: ${outputDir}`);
  console.log(`[intelligence] Incremental: ${incremental}`);
  console.log("");

  try {
    await runIntelligencePipeline({
      projectRoot,
      outputDir,
      appDir,
      incremental,
    });
    console.log("\n[intelligence] Done.");
  } catch (error) {
    console.error("[intelligence] Failed:", error);
    process.exit(1);
  }
}

main();
