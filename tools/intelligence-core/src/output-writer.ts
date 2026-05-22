import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type {
  IntelligenceManifest,
  DependencyGraph,
  RouteIntelligence,
  RuntimeMeta,
  SeparatedGraphs,
  Diagnostic,
} from "@i2c/intelligence-types";

/**
 * Writes deterministic, serializable JSON intelligence files to disk.
 */
export class OutputWriter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Write all output files from the manifest.
   */
  async writeAll(manifest: IntelligenceManifest): Promise<void> {
    await this.ensureDir(this.outputDir);
    await Promise.all([
      this.writeManifest(manifest),
      this.writeGraph(manifest.graph),
      this.writeSeparatedGraphs(manifest.graphs),
      this.writeRoutes(manifest.routeIntelligence),
      this.writeRuntime(manifest.runtime),
      this.writeDiagnostics(manifest.diagnostics),
    ]);
  }

  /**
   * Write manifest.json.
   */
  async writeManifest(manifest: IntelligenceManifest): Promise<void> {
    const filePath = resolve(this.outputDir, "manifest.json");
    await this.writeJson(filePath, manifest);
  }

  /**
   * Write graph.json (unified).
   */
  async writeGraph(graph: DependencyGraph): Promise<void> {
    const filePath = resolve(this.outputDir, "graph.json");
    await this.writeJson(filePath, graph);
  }

  /**
   * Write separated graphs.
   */
  async writeSeparatedGraphs(graphs: SeparatedGraphs): Promise<void> {
    const graphsDir = resolve(this.outputDir, "graphs");
    await this.ensureDir(graphsDir);
    await Promise.all([
      this.writeJson(resolve(graphsDir, "import.json"), graphs.import),
      this.writeJson(resolve(graphsDir, "render.json"), graphs.render),
      this.writeJson(resolve(graphsDir, "composite-ownership.json"), graphs.compositeOwnership),
      this.writeJson(resolve(graphsDir, "runtime-mount.json"), graphs.runtimeMount),
    ]);
  }

  /**
   * Write routes.json.
   */
  async writeRoutes(routeIntelligence: Record<string, RouteIntelligence>): Promise<void> {
    const filePath = resolve(this.outputDir, "routes.json");
    await this.writeJson(filePath, routeIntelligence);
  }

  /**
   * Write runtime.json.
   */
  async writeRuntime(runtime: Record<string, RuntimeMeta>): Promise<void> {
    const filePath = resolve(this.outputDir, "runtime.json");
    await this.writeJson(filePath, runtime);
  }

  /**
   * Write diagnostics.json.
   */
  async writeDiagnostics(diagnostics: Diagnostic[]): Promise<void> {
    const filePath = resolve(this.outputDir, "diagnostics.json");
    await this.writeJson(filePath, diagnostics);
  }

  /**
   * Write JSON to file with deterministic key ordering.
   */
  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir(dirname(filePath));
    const content = JSON.stringify(data, this.deterministicReplacer(), 2) + "\n";
    await writeFile(filePath, content, "utf-8");
  }

  /**
   * Ensure a directory exists.
   */
  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /**
   * JSON replacer that sorts object keys for deterministic output.
   */
  private deterministicReplacer(): (key: string, value: unknown) => unknown {
    return (_key: string, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return value;
    };
  }
}
