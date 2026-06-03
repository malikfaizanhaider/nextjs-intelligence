import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnalyzerConfig } from "../../intelligence-types/src/index";

/**
 * Files probed (in order) for project-level analyzer configuration. The first
 * existing entry wins; downstream files are ignored once a file is found.
 *
 * Supported formats:
 *   - `.intelligencerc.json`            — JSON object
 *   - `.intelligencerc`                 — JSON object
 *   - `intelligence.config.mjs`         — ESM module exporting either a
 *                                         default object or `config` named export.
 *   - `intelligence.config.js`          — same shape; loaded via dynamic import.
 *
 * `intelligence.config.ts` is intentionally NOT supported here: the loader is
 * pure Node and does not depend on a TypeScript runtime. Authors that prefer
 * TS should compile first or use the JS variant.
 */
const CONFIG_FILES = [
  ".intelligencerc.json",
  ".intelligencerc",
  "intelligence.config.mjs",
  "intelligence.config.js",
] as const;

/**
 * Result of loading config: includes the resolved partial config and the
 * absolute path of the file consumed (or `null` when no file was found).
 */
export interface ConfigLoadResult {
  /** Partial config loaded from disk, ready to be merged with CLI flags and defaults. */
  config: Partial<AnalyzerConfig>;
  /** Absolute path to the file used, or null if no config file was discovered. */
  filePath: string | null;
}

/**
 * Load `.intelligencerc.*` / `intelligence.config.*` from the given project
 * root and return a normalized partial AnalyzerConfig. Never throws on a
 * missing file (returns empty config). Throws when a file is present but
 * cannot be parsed or does not export an object — that case is operator error
 * and should fail fast.
 *
 * Merge precedence (callers' responsibility):
 *   defaults < loaded config < CLI/programmatic flags
 */
export async function loadConfigFile(projectRoot: string): Promise<ConfigLoadResult> {
  const absoluteRoot = resolve(projectRoot);
  for (const fileName of CONFIG_FILES) {
    const filePath = join(absoluteRoot, fileName);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const config = await readConfigFile(filePath);
    return { config, filePath };
  }

  return { config: {}, filePath: null };
}

async function readConfigFile(filePath: string): Promise<Partial<AnalyzerConfig>> {
  if (filePath.endsWith(".json") || filePath.endsWith(".intelligencerc")) {
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `[intelligence] Failed to parse config file ${filePath}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
    }
    return validateConfigShape(parsed, filePath);
  }

  // .mjs / .js — load via dynamic import. Use file:// URL so absolute Windows
  // paths work across Node versions.
  const url = pathToFileURL(filePath).href;
  const mod = (await import(url)) as { default?: unknown; config?: unknown };
  const value = (mod.default ?? mod.config) as unknown;
  if (value === undefined) {
    throw new Error(
      `[intelligence] Config file ${filePath} must export either a default export or a named "config" export.`
    );
  }
  return validateConfigShape(value, filePath);
}

function validateConfigShape(value: unknown, filePath: string): Partial<AnalyzerConfig> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `[intelligence] Config in ${filePath} must be a plain object; got ${
        Array.isArray(value) ? "array" : typeof value
      }.`
    );
  }
  // Cast is intentional — keys are validated downstream by the pipeline; this
  // loader only enforces the structural envelope.
  return value as Partial<AnalyzerConfig>;
}

/**
 * Merge a loaded config and a user-supplied (CLI/programmatic) partial config.
 * The user partial wins on conflicts. Array fields are REPLACED rather than
 * concatenated to match the principle of least surprise — callers that want
 * to extend the loaded `include`/`exclude` lists should read the file, mutate,
 * then re-pass.
 */
export function mergeConfigs(
  loaded: Partial<AnalyzerConfig>,
  user: Partial<AnalyzerConfig>
): Partial<AnalyzerConfig> {
  return { ...loaded, ...user };
}
