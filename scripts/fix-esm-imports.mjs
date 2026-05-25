/**
 * Post-build script: adds .js extensions to all relative imports in dist/
 * Required for Node.js ESM module resolution.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const DIST_DIR = resolve(import.meta.dirname, "..", "dist");

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      yield fullPath;
    }
  }
}

const IMPORT_RE = /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g;

function addJsExtensions(content) {
  return content.replace(IMPORT_RE, (match, prefix, path, suffix) => {
    // Skip if already has .js or .json extension
    if (path.endsWith(".js") || path.endsWith(".json")) return match;
    return `${prefix}${path}.js${suffix}`;
  });
}

async function main() {
  let fixed = 0;
  for await (const filePath of walk(DIST_DIR)) {
    const original = await readFile(filePath, "utf-8");
    const updated = addJsExtensions(original);
    if (updated !== original) {
      await writeFile(filePath, updated, "utf-8");
      fixed++;
    }
  }
  console.log(`[fix-esm] Added .js extensions in ${fixed} files.`);
}

main();
