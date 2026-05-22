import type {
  GraphEdge,
  ComponentMeta,
  RouteMeta,
  DependencyGraph,
  GraphNode,
  SeparatedGraphs,
  ImportGraph,
  RenderGraph,
  CompositeOwnershipGraph,
  RuntimeMountGraph,
  ConfidenceMeta,
} from "../@i2c/intelligence-types";
import type { CompositeGroup } from "./composite-detector";

/**
 * Builds SEPARATED dependency graphs from analyzed components, routes, and edges.
 *
 * Maintains distinct graphs for different relationship types:
 *   A. Import Graph: A imports B (module-level dependency)
 *   B. Render Graph: A renders B (JSX containment)
 *   C. Composite Ownership Graph: B belongs to A (compound component)
 *   D. Runtime Mount Graph: B mounted under A (actual DOM hierarchy)
 *
 * These relationships are semantically different and MUST NOT be conflated.
 */
export class GraphBuilder {
  private nodes = new Map<string, GraphNode>();

  // Separated edge collections
  private importEdges: GraphEdge[] = [];
  private renderEdges: GraphEdge[] = [];
  private ownershipEdges: GraphEdge[] = [];
  private mountEdges: GraphEdge[] = [];
  private routeEdges: GraphEdge[] = [];
  private parentChildEdges: GraphEdge[] = [];
  private reuseEdges: GraphEdge[] = [];

  /**
   * Add component nodes to the graph.
   */
  addComponents(components: ComponentMeta[]): void {
    for (const component of components) {
      this.nodes.set(component.id, {
        id: component.id,
        label: component.name,
        type: component.type,
        meta: {
          filePath: component.relativePath,
          rendering: component.rendering,
          isReusable: component.isReusable,
          isComposite: component.isComposite,
          canonicalId: component.identity?.canonicalId ?? component.id,
        },
      });
    }
  }

  /**
   * Add route nodes and route-to-component edges.
   */
  addRoutes(routes: RouteMeta[], components: ComponentMeta[]): void {
    for (const route of routes) {
      const routeId = `route::${route.path}`;
      this.nodes.set(routeId, {
        id: routeId,
        label: route.path,
        type: "route",
      });

      // Link route to its page component
      const pageComponent = components.find((c) => {
        const normalizedComponentPath = c.filePath.replace(/\\/g, "/");
        const normalizedRoutePath = route.filePath.replace(/\\/g, "/");
        return normalizedComponentPath === normalizedRoutePath;
      });

      if (pageComponent) {
        this.routeEdges.push({
          source: routeId,
          target: pageComponent.id,
          relationship: "routes-to",
        });

        if (!pageComponent.usedInRoutes.includes(route.path)) {
          pageComponent.usedInRoutes.push(route.path);
        }
      }

      // Link route to layout component
      if (route.layoutFilePath) {
        const layoutComponent = components.find((c) => {
          const normalizedComponentPath = c.filePath.replace(/\\/g, "/");
          const normalizedLayoutPath = route.layoutFilePath!.replace(/\\/g, "/");
          return normalizedComponentPath === normalizedLayoutPath;
        });
        if (layoutComponent) {
          this.routeEdges.push({
            source: routeId,
            target: layoutComponent.id,
            relationship: "routes-to",
          });
        }
      }

      // Parent route relationships
      if (route.parentRoute) {
        const parentRouteId = `route::${route.parentRoute}`;
        if (this.nodes.has(parentRouteId)) {
          this.parentChildEdges.push({
            source: parentRouteId,
            target: routeId,
            relationship: "parent-child",
          });
        }
      }
    }
  }

  /**
   * Add import edges (module-level dependencies).
   */
  addImportEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      this.importEdges.push({
        ...edge,
        relationship: "imports",
      });
    }
  }

  /**
   * Add render edges (JSX containment).
   */
  addRenderEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      this.renderEdges.push({
        ...edge,
        relationship: "renders",
      });
    }
  }

  /**
   * Add composite ownership edges from detected composite groups.
   */
  addCompositeOwnership(composites: Map<string, CompositeGroup>, components: ComponentMeta[]): void {
    for (const [, group] of composites) {
      const rootComp = components.find((c) => c.name === group.root);
      if (!rootComp) continue;

      for (const subName of group.subComponents) {
        // Find sub-component by full prefixed name
        const subComp = components.find(
          (c) => c.name === `${group.root}${subName}` || c.name === subName
        );
        if (subComp) {
          this.ownershipEdges.push({
            source: rootComp.id,
            target: subComp.id,
            relationship: "owns",
            confidence: group.confidence,
          });
        }
      }
    }
  }

  /**
   * Add pre-computed edges and classify them into appropriate graphs.
   */
  addEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      switch (edge.relationship) {
        case "imports":
          this.importEdges.push(edge);
          break;
        case "renders":
          this.renderEdges.push(edge);
          break;
        case "owns":
          this.ownershipEdges.push(edge);
          break;
        case "mounts":
          this.mountEdges.push(edge);
          break;
        case "routes-to":
          this.routeEdges.push(edge);
          break;
        case "parent-child":
          this.parentChildEdges.push(edge);
          break;
        case "reuses":
          this.reuseEdges.push(edge);
          break;
        default:
          this.importEdges.push(edge);
      }
    }
  }

  /**
   * Add reusable component edges.
   */
  addReusabilityEdges(components: ComponentMeta[]): void {
    for (const component of components) {
      if (component.isReusable) {
        for (const usedInFile of component.usedInFiles) {
          const consumers = components.filter((c) => c.relativePath === usedInFile);
          for (const consumer of consumers) {
            this.reuseEdges.push({
              source: consumer.id,
              target: component.id,
              relationship: "reuses",
            });
          }
        }
      }
    }
  }

  /**
   * Build separated graphs — each relationship type has its own graph.
   */
  buildSeparated(): SeparatedGraphs {
    const allNodes = Array.from(this.nodes.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    return {
      import: {
        nodes: allNodes,
        edges: this.dedup(this.importEdges),
      },
      render: {
        nodes: allNodes,
        edges: this.dedup(this.renderEdges),
      },
      compositeOwnership: {
        nodes: allNodes,
        edges: this.dedup(this.ownershipEdges),
      },
      runtimeMount: {
        nodes: allNodes,
        edges: this.dedup(this.mountEdges),
      },
    };
  }

  /**
   * Build unified dependency graph (backward compatibility).
   */
  build(): DependencyGraph {
    const allEdges = [
      ...this.importEdges,
      ...this.renderEdges,
      ...this.ownershipEdges,
      ...this.mountEdges,
      ...this.routeEdges,
      ...this.parentChildEdges,
      ...this.reuseEdges,
    ];

    return {
      nodes: Array.from(this.nodes.values()).sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
      edges: this.dedup(allEdges),
    };
  }

  /**
   * Deduplicate edges by source+target+relationship key.
   */
  private dedup(edges: GraphEdge[]): GraphEdge[] {
    const unique = new Map<string, GraphEdge>();
    for (const edge of edges) {
      const key = `${edge.source}|${edge.target}|${edge.relationship}`;
      if (!unique.has(key)) {
        unique.set(key, edge);
      }
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    );
  }
}
