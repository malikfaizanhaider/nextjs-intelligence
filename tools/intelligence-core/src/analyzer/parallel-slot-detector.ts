import { access } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import fg from "fast-glob";
import type { ParallelSlot } from "../../../intelligence-types/src/index";

/**
 * Detect Next.js parallel route slots (`@slot/page.{tsx,ts,jsx,js}`) under
 * the given app directories.
 *
 * The slot's *parent path* is the URL of the closest ancestor layout/page —
 * i.e. the directory that contains the `@slot` folder, projected through the
 * normal App Router rules (route groups stripped, dynamic segments preserved).
 */
export async function detectParallelSlots(
  projectRoot: string,
  appDirs: string | string[]
): Promise<ParallelSlot[]> {
  const dirs = Array.isArray(appDirs) ? appDirs : [appDirs];
  const slots: ParallelSlot[] = [];

  for (const appDir of dirs) {
    const absoluteAppDir = resolve(projectRoot, appDir).replace(/\\/g, "/");

    // Match any page file whose path contains an `@slotName/` segment.
    const candidates = await fg(
      "**/@*/**/page.{ts,tsx,js,jsx}",
      {
        cwd: absoluteAppDir,
        absolute: false,
        onlyFiles: true,
        ignore: ["node_modules/**", ".next/**"],
      }
    );

    for (const file of candidates.sort()) {
      const segments = file.replace(/\\/g, "/").split("/");
      // Locate the FIRST `@slot` segment so nested slots resolve to their
      // most-immediate parent layout.
      const slotIdx = segments.findIndex((s) => s.startsWith("@"));
      if (slotIdx === -1) continue;
      const slotSegment = segments[slotIdx]!;
      const slotName = slotSegment.slice(1);

      const parentDir = segments.slice(0, slotIdx).join("/");
      const parentPath = parentDir === "" ? "/" : buildRoutePath(parentDir);

      const absolutePath = resolve(absoluteAppDir, file);
      const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, "/");

      // Check for a `default.{ext}` fallback in the slot directory.
      const slotDir = dirname(absolutePath);
      const hasDefault = await fileExistsWithExtensions(
        slotDir,
        "default",
        ["tsx", "ts", "jsx", "js"]
      );

      slots.push({
        name: slotName,
        parentPath,
        filePath: absolutePath,
        relativePath,
        hasDefault,
      });
    }
  }

  return slots.sort(
    (a, b) =>
      a.parentPath.localeCompare(b.parentPath) || a.name.localeCompare(b.name)
  );
}

function buildRoutePath(dir: string): string {
  const segments = dir.split("/").filter(Boolean);
  const out: string[] = [];
  for (const segment of segments) {
    if (/^\(.*\)$/.test(segment)) continue; // route group
    if (segment.startsWith("@")) continue; // ignore further slots in ancestry
    out.push(segment);
  }
  return "/" + out.join("/");
}

async function fileExistsWithExtensions(
  dir: string,
  base: string,
  exts: readonly string[]
): Promise<boolean> {
  for (const ext of exts) {
    try {
      await access(resolve(dir, `${base}.${ext}`));
      return true;
    } catch {
      // Continue probing.
    }
  }
  return false;
}
