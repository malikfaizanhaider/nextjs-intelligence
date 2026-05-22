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
   * Compute SHA-256 hash of content.
   */
  private computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
