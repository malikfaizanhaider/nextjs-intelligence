import { relative, resolve } from "node:path";
import type { IntelligenceManifest, GraphEdge } from "../../../intelligence-types/src/index";
import { runIntelligencePipelineDetailed } from "../pipeline";
import { silentLogger } from "../logger";

export interface McpAnalysisOptions {
  projectRoot?: string;
  outputDir?: string;
  appDir?: string;
  incremental?: boolean;
}

export interface DependencyGraphResult {
  node: string;
  upstream: GraphEdge[];
  downstream: GraphEdge[];
}

export interface ImpactAnalysisResult extends DependencyGraphResult {
  file: string;
  affectedRoutes: string[];
  affectedComponents: string[];
  affectedApis: string[];
  dependencyChain: GraphEdge[];
}

export class IntelligenceAnalysisService {
  private manifestPromise: Promise<IntelligenceManifest> | null = null;

  constructor(private readonly options: McpAnalysisOptions = {}) {}

  async getManifest(): Promise<IntelligenceManifest> {
    this.manifestPromise ??= this.loadManifest();
    return this.manifestPromise;
  }

  refresh(): void {
    this.manifestPromise = null;
  }

  async analyzeProject(): Promise<Pick<IntelligenceManifest, "summary" | "generatedAt" | "projectRoot" | "schemaVersion">> {
    const manifest = await this.getManifest();
    return {
      schemaVersion: manifest.schemaVersion,
      generatedAt: manifest.generatedAt,
      projectRoot: manifest.projectRoot,
      summary: manifest.summary,
    };
  }

  async getRoutes(): Promise<IntelligenceManifest["routes"]> {
    return (await this.getManifest()).routes;
  }

  async analyzeRoute(route: string): Promise<unknown> {
    const manifest = await this.getManifest();
    const routeMeta = manifest.routes.find((candidate) => candidate.path === route) ?? null;
    const intelligence = manifest.routeIntelligence[route] ?? null;
    return {
      route: routeMeta,
      intelligence,
      components: intelligence?.components.map((id) => manifest.components[id] ?? id) ?? [],
      hooks: intelligence?.hooks ?? [],
      providers: intelligence?.providers ?? [],
      complexity: intelligence?.complexity ?? null,
      dependencies: intelligence?.dependencies ?? [],
    };
  }

  async getApiRoutes(): Promise<IntelligenceManifest["apiRoutes"]> {
    return (await this.getManifest()).apiRoutes;
  }

  async findComponentUsage(component: string): Promise<unknown> {
    const manifest = await this.getManifest();
    const matches = Object.values(manifest.components).filter(
      (candidate) => candidate.name === component || candidate.id === component || candidate.relativePath.endsWith(component)
    );
    const ids = new Set(matches.map((match) => match.id));
    if (ids.size === 0 && manifest.componentUsage[component]) ids.add(component);
    const renderRelationships = manifest.graphs.render.edges.filter(
      (edge) => ids.has(edge.source) || ids.has(edge.target)
    );
    return {
      query: component,
      components: [...ids].map((id) => manifest.components[id] ?? id),
      usages: [...ids].map((id) => ({ componentId: id, usage: manifest.componentUsage[id] ?? null })),
      renderRelationships,
    };
  }

  async getDependencyGraph(node: string): Promise<DependencyGraphResult> {
    const manifest = await this.getManifest();
    const resolved = this.resolveNode(manifest, node);
    return this.buildDependencyGraphResult(manifest, resolved);
  }

  async findOrphans(): Promise<unknown> {
    const manifest = await this.getManifest();
    const derivedOrphans = manifest.derived?.deadComponents ?? [];
    const orphanIds = derivedOrphans.length > 0
      ? derivedOrphans
      : Object.values(manifest.components)
          .filter((component) => component.usedInFiles.length === 0 && component.usedInRoutes.length === 0)
          .map((component) => component.id);
    return orphanIds.map((id) => manifest.components[id] ?? id);
  }

  async impactAnalysis(file: string): Promise<ImpactAnalysisResult> {
    const manifest = await this.getManifest();
    const normalizedFile = this.normalizeRelative(manifest, file);
    const relatedComponents = Object.values(manifest.components).filter(
      (component) => component.relativePath === normalizedFile || component.filePath === file || component.id === file
    );
    const relatedIds = new Set(relatedComponents.map((component) => component.id));
    if (manifest.components[file]) relatedIds.add(file);
    const dependencyChain = manifest.graph.edges.filter(
      (edge) => relatedIds.has(edge.source) || relatedIds.has(edge.target) || edge.source === normalizedFile || edge.target === normalizedFile
    );
    const affectedComponents = new Set<string>(relatedIds);
    for (const edge of dependencyChain) {
      affectedComponents.add(edge.source);
      affectedComponents.add(edge.target);
    }
    const affectedRoutes = new Set<string>();
    for (const route of Object.values(manifest.routeIntelligence)) {
      if (route.relativePath === normalizedFile || route.dependencyFiles?.includes(normalizedFile) || route.components.some((id) => affectedComponents.has(id))) {
        affectedRoutes.add(route.path);
      }
    }
    const affectedApis = manifest.apiRoutes
      .filter((api) => api.relativePath === normalizedFile)
      .map((api) => api.path);
    const graph = this.buildDependencyGraphResult(manifest, relatedIds.values().next().value ?? normalizedFile);
    return {
      file: normalizedFile,
      affectedRoutes: [...affectedRoutes].sort(),
      affectedComponents: [...affectedComponents].sort(),
      affectedApis,
      dependencyChain,
      ...graph,
    };
  }

  private async loadManifest(): Promise<IntelligenceManifest> {
    const projectRoot = resolve(this.options.projectRoot ?? process.cwd());
    const { manifest } = await runIntelligencePipelineDetailed(
      {
        projectRoot,
        outputDir: this.options.outputDir ?? ".generated/intelligence",
        appDir: this.options.appDir,
        incremental: this.options.incremental ?? true,
      },
      { logger: silentLogger, quiet: true }
    );
    return manifest;
  }

  private resolveNode(manifest: IntelligenceManifest, node: string): string {
    if (manifest.components[node]) return node;
    const normalized = this.normalizeRelative(manifest, node);
    const match = Object.values(manifest.components).find(
      (component) => component.relativePath === normalized || component.filePath === node || component.name === node
    );
    return match?.id ?? node;
  }

  private normalizeRelative(manifest: IntelligenceManifest, value: string): string {
    if (value.startsWith(manifest.projectRoot)) return relative(manifest.projectRoot, value).replace(/\\/g, "/");
    return value.replace(/\\/g, "/");
  }

  private buildDependencyGraphResult(manifest: IntelligenceManifest, node: string): DependencyGraphResult {
    return {
      node,
      upstream: manifest.graph.edges.filter((edge) => edge.target === node),
      downstream: manifest.graph.edges.filter((edge) => edge.source === node),
    };
  }
}
