import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

interface CacheEntry {
  hash: string;
  timestamp: string;
}

interface CacheData {
  version: number;
  entries: Record<string, CacheEntry>;
}

/**
 * File-level cache to enable incremental scanning.
 * Stores file content hashes and skips unchanged files.
 */
export class IncrementalCache {
  private cacheDir: string;
  private cacheFile: string;
  private data: CacheData = { version: 1, entries: {} };

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.cacheFile = resolve(cacheDir, "intelligence-cache.json");
  }

  /**
   * Load the cache from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.cacheFile, "utf-8");
      const parsed = JSON.parse(content) as CacheData;
      if (parsed.version === 1) {
        this.data = parsed;
      }
    } catch {
      // No cache file or invalid — start fresh
      this.data = { version: 1, entries: {} };
    }
  }

  /**
   * Save the cache to disk.
   */
  async save(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.cacheFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  /**
   * Check if a file has changed since last scan.
   */
  hasChanged(filePath: string, content: string): boolean {
    const hash = this.computeHash(content);
    const entry = this.data.entries[filePath];
    return !entry || entry.hash !== hash;
  }

  /**
   * Update the cache entry for a file.
   */
  update(filePath: string, content: string): void {
    this.data.entries[filePath] = {
      hash: this.computeHash(content),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Remove a file from the cache.
   */
  remove(filePath: string): void {
    delete this.data.entries[filePath];
  }

  /**
   * Get all cached file paths.
   */
  getCachedPaths(): string[] {
    return Object.keys(this.data.entries);
  }

  /**
   * Classify a snapshot of the current project files against the cache.
   *
   * Returns:
   *   - `added`   files present in `currentFiles` but not in the cache
   *   - `changed` files whose content hash differs from the cached entry
   *   - `removed` files cached previously but no longer present
   *   - `unchanged` files with matching hashes
   *
   * The "invalidation frontier" is `added \u222a changed \u222a removed`. A future
   * pass-aware scheduler can use this set to decide which downstream passes
   * (per-route intelligence, graph sub-trees) must be re-executed.
   */
  classifyChanges(
    currentFiles: { filePath: string; content: string }[]
  ): { added: string[]; changed: string[]; removed: string[]; unchanged: string[] } {
    const added: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];
    const seen = new Set<string>();

    for (const { filePath, content } of currentFiles) {
      seen.add(filePath);
      const entry = this.data.entries[filePath];
      if (!entry) {
        added.push(filePath);
        continue;
      }
      if (entry.hash !== this.computeHash(content)) {
        changed.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    const removed = Object.keys(this.data.entries).filter((p) => !seen.has(p));
    return { added, changed, removed, unchanged };
  }

  /**
   * Convenience wrapper for {@link classifyChanges} that returns just the
   * invalidation frontier (`added \u222a changed \u222a removed`).
   */
  getChangedFiles(
    currentFiles: { filePath: string; content: string }[]
  ): string[] {
    const { added, changed, removed } = this.classifyChanges(currentFiles);
    return [...added, ...changed, ...removed];
  }

  /**
   * Replace all cache entries with a snapshot of the supplied files. Use this
   * after a successful pipeline run so the next invocation sees the exact set
   * of files that were analyzed (any file no longer present is implicitly
   * dropped). This is the inverse of {@link classifyChanges}: that method
   * compares an incoming snapshot to the cache, this one *adopts* the
   * snapshot as the new ground truth.
   */
  replaceAll(currentFiles: { filePath: string; content: string }[]): void {
    const timestamp = new Date().toISOString();
    const entries: Record<string, CacheEntry> = {};
    for (const { filePath, content } of currentFiles) {
      entries[filePath] = { hash: this.computeHash(content), timestamp };
    }
    this.data = { version: 1, entries };
  }

  /** True when the loaded cache had at least one entry (i.e. a prior run was
   *  persisted). Used to gate "no changes → reuse manifest" short-circuit:
   *  an empty cache means there is no previous run to reuse. */
  hasPriorSnapshot(): boolean {
    return Object.keys(this.data.entries).length > 0;
  }

  /**
   * Compute SHA-256 hash of content.
   */
  private computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
