#!/usr/bin/env node

import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { runIntelligencePipelineDetailed } from "./pipeline";
import { startMcpServer } from "./mcp/server";
import { consoleLogger, silentLogger } from "./logger";
import { diffManifests, formatManifestDiff } from "./manifest-diff";
import type { IntelligenceManifest } from "../../intelligence-types/src/index";

const args = process.argv.slice(2);

const HELP = `intelligence — static analyzer for Next.js apps

Usage: intelligence [command] [options]

Commands:
  analyze               Run the analyzer (default)
  graph                 Run the analyzer and emit the dependency graph with --json
  diagnostics           Run the analyzer and emit diagnostics with --json
  mcp                   Start an MCP server over stdio

Options:
  --root <path>         Project root (default: cwd)
  --output <dir>        Output directory (default: .generated/intelligence)
  --app-dir <dir>       Override app directory auto-detection
  --no-cache            Disable incremental cache
  --watch               Re-run pipeline on file changes (uses incremental cache)
  --watch-debounce <ms> Coalesce bursts of file changes (default: 150)
  --quiet               Suppress phase-by-phase log output
  --stats               Print per-phase telemetry summary at end
  --diff                Print delta vs. previous manifest (routes, components, diagnostics)
  --json                Emit machine-readable JSON to stdout (stats/diff/summary). Implies --quiet.
  --fail-on-error       Exit 1 if any error diagnostics are emitted
  --help, -h            Show this help and exit
`;

function parseArgs(input: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < input.length; i++) {
    const arg = input[i]!;
    if (arg === "-h") {
      result["help"] = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = input[i + 1];
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

function formatStats(telemetry: import("../../intelligence-types/src/index").PipelineTelemetry): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Pipeline telemetry");
  lines.push("──────────────────");
  lines.push(`Total: ${telemetry.totalDurationMs}ms`);
  lines.push(
    `Parse: ${telemetry.parse.succeeded}/${telemetry.parse.attempted} files (${telemetry.parse.failed} failed)`
  );
  lines.push(
    `Diagnostics: ${telemetry.diagnostics.error} error, ${telemetry.diagnostics.warning} warning, ${telemetry.diagnostics.info} info`
  );
  lines.push("");
  lines.push("Phase                    Duration   Counts");
  for (const p of telemetry.phases) {
    const name = `${p.phase}. ${p.name}`.padEnd(24, " ");
    const dur = `${p.durationMs}ms`.padEnd(10, " ");
    const counts = Object.entries(p.counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`${name} ${dur} ${counts}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const command = args.find((arg) => !arg.startsWith("-")) ?? "analyze";
  const optionArgs = command === "analyze" ? args : args.filter((arg) => arg !== command);
  const parsed = parseArgs(optionArgs);

  if (parsed["help"] === "true") {
    process.stdout.write(HELP);
    return;
  }

  const projectRoot = parsed["root"] ? resolve(parsed["root"]) : process.cwd();
  const outputDir = parsed["output"] ?? ".generated/intelligence";
  const appDir = parsed["app-dir"];
  const incremental = parsed["no-cache"] !== "true";
  const jsonMode = parsed["json"] === "true";
  // --json implies --quiet so stdout stays a single parseable document.
  const quiet = parsed["quiet"] === "true" || jsonMode;
  const showStats = parsed["stats"] === "true";
  const failOnError = parsed["fail-on-error"] === "true";
  const watchMode = parsed["watch"] === "true";
  const watchDebounceMs = Number.parseInt(parsed["watch-debounce"] ?? "150", 10);
  const showDiff = parsed["diff"] === "true";

  if (command === "mcp") {
    await startMcpServer({ projectRoot, outputDir, appDir, incremental });
    return;
  }

  if (!["analyze", "graph", "diagnostics"].includes(command)) {
    process.stderr.write(`[intelligence] Unknown command: ${command}\n`);
    process.exit(2);
  }

  if (jsonMode && watchMode) {
    process.stderr.write("[intelligence] --json is not supported with --watch.\n");
    process.exit(2);
  }

  const logger = quiet ? silentLogger : consoleLogger;

  logger.info(`Project root: ${projectRoot}`);
  logger.info(`App directory override: ${appDir ?? "<auto-detect>"}`);
  logger.info(`Output: ${outputDir}`);
  logger.info(`Incremental: ${incremental}`);
  if (watchMode) logger.info(`Watch: enabled (debounce ${watchDebounceMs}ms)`);
  logger.info("");

  /**
   * Snapshot the on-disk manifest before the pipeline overwrites it. Returns
   * `null` when there is no prior manifest (cold run) or it is unreadable —
   * in either case `--diff` simply prints nothing rather than failing.
   */
  const snapshotPriorManifest = async (): Promise<IntelligenceManifest | null> => {
    const manifestPath = join(resolve(projectRoot, outputDir), "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf-8");
      return JSON.parse(raw) as IntelligenceManifest;
    } catch {
      return null;
    }
  };

  /**
   * Single pipeline invocation. Returns the diagnostic-error count so the
   * watch loop can decide whether to surface a non-zero exit code at shutdown.
   * Errors thrown by the pipeline propagate in one-shot mode (caller logs +
   * exits) but are caught and logged in watch mode so a transient failure
   * doesn't tear down the watcher.
   */
  const runOnce = async (): Promise<number> => {
    // Snapshot BEFORE the pipeline so the on-disk manifest from the prior
    // run is preserved for diffing — the pipeline writes over it.
    const prior = showDiff ? await snapshotPriorManifest() : null;
    const startedAt = Date.now();
    const { manifest, telemetry } = await runIntelligencePipelineDetailed(
      { projectRoot, outputDir, appDir, incremental },
      { logger }
    );
    if (jsonMode) {
      const payload: Record<string, unknown> = {
        ok: telemetry.diagnostics.error === 0,
        durationMs: Date.now() - startedAt,
        summary: manifest.summary,
        diagnostics: telemetry.diagnostics,
      };
      if (command === "graph") payload.graph = manifest.graph;
      if (command === "diagnostics") payload.diagnosticsList = manifest.diagnostics;
      if (showStats) payload.telemetry = telemetry;
      if (showDiff) {
        payload.diff = prior ? diffManifests(prior, manifest) : null;
      }
      process.stdout.write(JSON.stringify(payload) + "\n");
    } else {
      if (showStats) {
        process.stdout.write(formatStats(telemetry) + "\n");
      }
      if (showDiff && prior) {
        const diffOutput = formatManifestDiff(diffManifests(prior, manifest));
        if (diffOutput) {
          process.stdout.write(diffOutput + "\n");
        } else {
          logger.info("Manifest diff: no changes since previous run.");
        }
      } else if (showDiff && !prior) {
        logger.info("Manifest diff: no previous manifest on disk (cold run).");
      }
    }
    void manifest;
    if (watchMode) {
      const elapsed = Date.now() - startedAt;
      const reused = telemetry.incremental?.cacheHit
        ? "cache hit"
        : telemetry.incremental
        ? `${telemetry.incremental.reusedRoutes ?? 0} reused, ${telemetry.incremental.changedFiles} changed`
        : "full run";
      logger.info(`[watch] rebuilt in ${elapsed}ms (${reused})`);
    } else if (!jsonMode) {
      logger.info("Done.");
    }
    return telemetry.diagnostics.error;
  };

  try {
    const errorCount = await runOnce();

    if (watchMode) {
      await runWatchLoop(projectRoot, watchDebounceMs, logger, runOnce);
      return; // Unreachable; watcher runs until SIGINT.
    }

    if (failOnError && errorCount > 0) {
      process.stderr.write(
        `[intelligence] Failing because --fail-on-error and ${errorCount} error diagnostic(s) were emitted.\n`
      );
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`[intelligence] Failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
}

/**
 * Watch loop using built-in `fs.watch` in recursive mode. Coalesces bursts
 * of filesystem events through a single debounce timer so an editor that
 * fires "save + format + rename temp file" (5-10 events) triggers exactly
 * one rebuild.
 *
 * Limitations:
 *   - `recursive: true` is supported on macOS, Windows, and Linux (Node 20+).
 *     On Linux <20 the watcher will throw at start-up; the user can either
 *     upgrade or run the CLI in a loop driven by an external file watcher.
 *   - Events for files outside the analyzer's include globs still wake the
 *     debouncer; the pipeline's own `IncrementalCache.classifyChanges` then
 *     treats them as unchanged and short-circuits. Cheap and avoids a
 *     duplicate glob filter at the watcher layer.
 *
 * The loop never resolves under normal operation; it returns only on a
 * fatal watcher error (which is re-thrown so `main()` exits non-zero).
 */
async function runWatchLoop(
  projectRoot: string,
  debounceMs: number,
  logger: import("./logger").Logger,
  runOnce: () => Promise<number>
): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(projectRoot, { recursive: true });
    } catch (error) {
      reject(
        new Error(
          `--watch requires recursive fs.watch support (macOS/Windows, or Linux on Node 20+). ` +
            `Underlying error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return;
    }

    let pendingRun: Promise<void> | null = null;
    let dirtyDuringRun = false;
    let debounceTimer: NodeJS.Timeout | null = null;

    const triggerRebuild = (): void => {
      // If a rebuild is already running, just mark dirty; the in-flight run
      // will re-fire one more time when it finishes (catches edits that
      // landed during the rebuild itself).
      if (pendingRun) {
        dirtyDuringRun = true;
        return;
      }
      pendingRun = (async () => {
        try {
          await runOnce();
        } catch (err) {
          logger.error(
            `[watch] rebuild failed: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          pendingRun = null;
          if (dirtyDuringRun) {
            dirtyDuringRun = false;
            triggerRebuild();
          }
        }
      })();
    };

    watcher.on("change", (_event, filename) => {
      // Ignore writes inside our own output / cache trees so we don't
      // re-trigger on the files we just emitted (`.generated/intelligence`
      // and `node_modules/.cache/intelligence`). The pipeline's include
      // globs already exclude these, but the watcher sees raw FS events.
      const name = filename?.toString() ?? "";
      if (
        name.includes(".generated") ||
        name.includes("node_modules") ||
        name.includes(".git") ||
        name.includes(".next")
      ) {
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        triggerRebuild();
      }, debounceMs);
    });

    watcher.on("error", (err) => {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      reject(err);
    });

    const shutdown = (): void => {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    logger.info("[watch] watching for changes — press Ctrl+C to stop");
  });
}

main();
