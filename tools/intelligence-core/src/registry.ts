import type {
  ComponentMeta,
  RouteMeta,
  RouteIntelligence,
  ComponentUsageMap,
  RuntimeMeta,
  DependencyGraph,
  IntelligenceManifest,
  IntelligenceSummary,
  GraphNode,
  GraphEdge,
  SeparatedGraphs,
  Diagnostic,
} from "@i2c/intelligence-types";

/**
 * Central singleton registry that aggregates build-time AST metadata
 * and runtime tracking data into a unified manifest.
 */
export class IntelligenceRegistry {
  private static instance: IntelligenceRegistry | null = null;

  private components = new Map<string, ComponentMeta>();
  private routes = new Map<string, RouteMeta>();
  private routeIntelligence = new Map<string, RouteIntelligence>();
  private componentUsage: ComponentUsageMap = {};
  private runtimeData = new Map<string, RuntimeMeta>();
  private graphNodes = new Map<string, GraphNode>();
  private graphEdges: GraphEdge[] = [];
  private projectRoot = "";

  private constructor() {}

  static getInstance(): IntelligenceRegistry {
    if (!IntelligenceRegistry.instance) {
      IntelligenceRegistry.instance = new IntelligenceRegistry();
    }
    return IntelligenceRegistry.instance;
  }

  static resetInstance(): void {
    IntelligenceRegistry.instance = null;
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  // ─── Component Registration ───────────────────────────────

  registerComponent(meta: ComponentMeta): void {
    this.components.set(meta.id, meta);
    this.graphNodes.set(meta.id, {
      id: meta.id,
      label: meta.name,
      type: meta.type,
    });
  }

  registerComponents(metas: ComponentMeta[]): void {
    for (const meta of metas) {
      this.registerComponent(meta);
    }
  }

  getComponent(id: string): ComponentMeta | undefined {
    return this.components.get(id);
  }

  getAllComponents(): Map<string, ComponentMeta> {
    return new Map(this.components);
  }

  // ─── Route Registration ───────────────────────────────────

  registerRoute(meta: RouteMeta): void {
    this.routes.set(meta.path, meta);
    this.graphNodes.set(`route::${meta.path}`, {
      id: `route::${meta.path}`,
      label: meta.path,
      type: "route",
    });
  }

  registerRoutes(metas: RouteMeta[]): void {
    for (const meta of metas) {
      this.registerRoute(meta);
    }
  }

  getRoute(path: string): RouteMeta | undefined {
    return this.routes.get(path);
  }

  getAllRoutes(): Map<string, RouteMeta> {
    return new Map(this.routes);
  }

  // ─── Route Intelligence ───────────────────────────────────

  registerRouteIntelligence(intelligence: Record<string, RouteIntelligence>): void {
    for (const [path, data] of Object.entries(intelligence)) {
      this.routeIntelligence.set(path, data);
    }
  }

  registerComponentUsage(usage: ComponentUsageMap): void {
    this.componentUsage = { ...this.componentUsage, ...usage };
  }

  getRouteIntelligence(path: string): RouteIntelligence | undefined {
    return this.routeIntelligence.get(path);
  }

  // ─── Runtime Tracking ─────────────────────────────────────

  mountComponent(componentId: string, route?: string): void {
    const existing = this.runtimeData.get(componentId);
    const now = new Date().toISOString();

    if (existing) {
      existing.mountCount += 1;
      existing.lastMountedAt = now;
      if (route && !existing.mountedOnRoutes.includes(route)) {
        existing.mountedOnRoutes.push(route);
      }
    } else {
      this.runtimeData.set(componentId, {
        componentId,
        mountCount: 1,
        unmountCount: 0,
        renderCount: 1,
        lastMountedAt: now,
        lastUnmountedAt: null,
        mountedOnRoutes: route ? [route] : [],
        averageRenderDuration: 0,
      });
    }
  }

  unmountComponent(componentId: string): void {
    const existing = this.runtimeData.get(componentId);
    if (existing) {
      existing.unmountCount += 1;
      existing.lastUnmountedAt = new Date().toISOString();
    }
  }

  recordRender(componentId: string, durationMs: number): void {
    const existing = this.runtimeData.get(componentId);
    if (existing) {
      const totalDuration = existing.averageRenderDuration * (existing.renderCount - 1) + durationMs;
      existing.renderCount += 1;
      existing.averageRenderDuration = totalDuration / (existing.renderCount - 1);
    }
  }

  getRuntimeData(componentId: string): RuntimeMeta | undefined {
    return this.runtimeData.get(componentId);
  }

  // ─── Graph Operations ─────────────────────────────────────

  addEdge(edge: GraphEdge): void {
    const exists = this.graphEdges.some(
      (e) => e.source === edge.source && e.target === edge.target && e.relationship === edge.relationship
    );
    if (!exists) {
      this.graphEdges.push(edge);
    }
  }

  addEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  // ─── Merge Runtime Data ───────────────────────────────────

  mergeRuntimeData(data: Record<string, RuntimeMeta>): void {
    for (const [id, meta] of Object.entries(data)) {
      const existing = this.runtimeData.get(id);
      if (existing) {
        existing.mountCount += meta.mountCount;
        existing.unmountCount += meta.unmountCount;
        existing.renderCount += meta.renderCount;
        existing.lastMountedAt = meta.lastMountedAt ?? existing.lastMountedAt;
        existing.lastUnmountedAt = meta.lastUnmountedAt ?? existing.lastUnmountedAt;
        for (const route of meta.mountedOnRoutes) {
          if (!existing.mountedOnRoutes.includes(route)) {
            existing.mountedOnRoutes.push(route);
          }
        }
      } else {
        this.runtimeData.set(id, { ...meta });
      }
    }
  }

  // ─── Summary ──────────────────────────────────────────────

  private computeSummary(): IntelligenceSummary {
    const components = Array.from(this.components.values());
    const intelligenceEntries = Array.from(this.routeIntelligence.values());

    const complexities = intelligenceEntries.map(
      (ri) => ri.complexity.components + ri.complexity.dependencies
    );
    const avgComplexity =
      complexities.length > 0
        ? Math.round(complexities.reduce((a, b) => a + b, 0) / complexities.length)
        : 0;
    const maxComplexity =
      complexities.length > 0 ? Math.max(...complexities) : 0;

    return {
      screens: this.routes.size,
      components: components.length,
      reusableComponents: components.filter((c) => c.isReusable).length,
      dialogs: components.filter((c) => c.type === "dialog").length,
      grids: components.filter((c) => c.type === "grid").length,
      charts: components.filter((c) => c.type === "chart").length,
      providers: components.filter((c) => c.type === "provider").length,
      layouts: components.filter((c) => c.type === "layout").length,
      pages: components.filter((c) => c.type === "page").length,
      hooks: new Set(intelligenceEntries.flatMap((ri) => ri.hooks)).size,
      utils: new Set(intelligenceEntries.flatMap((ri) => ri.utils)).size,
      clientComponents: components.filter((c) => c.rendering === "client").length,
      serverComponents: components.filter((c) => c.rendering === "server").length,
      avgComplexity,
      maxComplexity,
    };
  }

  // ─── Export ───────────────────────────────────────────────

  exportGraph(): DependencyGraph {
    return {
      nodes: Array.from(this.graphNodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.graphEdges].sort((a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
      ),
    };
  }

  exportManifest(): IntelligenceManifest {
    const componentsRecord: Record<string, ComponentMeta> = {};
    for (const [id, meta] of this.components) {
      componentsRecord[id] = meta;
    }

    const runtimeRecord: Record<string, RuntimeMeta> = {};
    for (const [id, meta] of this.runtimeData) {
      runtimeRecord[id] = meta;
    }

    const routeIntelligenceRecord: Record<string, RouteIntelligence> = {};
    for (const [path, data] of this.routeIntelligence) {
      routeIntelligenceRecord[path] = data;
    }

    // Separated graphs and diagnostics are attached by the pipeline after export
    const emptySeparatedGraphs: SeparatedGraphs = {
      import: { nodes: [], edges: [] },
      render: { nodes: [], edges: [] },
      compositeOwnership: { nodes: [], edges: [] },
      runtimeMount: { nodes: [], edges: [] },
    };

    return {
      generatedAt: new Date().toISOString(),
      projectRoot: this.projectRoot,
      summary: this.computeSummary(),
      routes: Array.from(this.routes.values()).sort((a, b) => a.path.localeCompare(b.path)),
      routeIntelligence: routeIntelligenceRecord,
      components: componentsRecord,
      componentUsage: { ...this.componentUsage },
      graph: this.exportGraph(),
      graphs: emptySeparatedGraphs,
      runtime: runtimeRecord,
      diagnostics: [],
    };
  }

  clear(): void {
    this.components.clear();
    this.routes.clear();
    this.routeIntelligence.clear();
    this.componentUsage = {};
    this.runtimeData.clear();
    this.graphNodes.clear();
    this.graphEdges = [];
    this.projectRoot = "";
  }
}
