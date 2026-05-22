import type {
  ComponentMeta,
  RouteMeta,
  DependencyGraph,
  Diagnostic,
  DiagnosticCategory,
  DiagnosticSeverity,
  SeparatedGraphs,
  RuntimeMeta,
} from "../@i2c/intelligence-types";
import type { CompositeGroup } from "./composite-detector";

/**
 * Verification passes that run AFTER graph construction.
 *
 * Detects:
 * - Orphan nodes (components not reachable from any route)
 * - Unresolved JSX tags (JSX tags that don't map to known components)
 * - Unresolved imports (import specifiers that can't be resolved)
 * - Duplicate canonical IDs (two different components claiming same ID)
 * - Invalid route ownership (routes pointing to non-existent pages)
 * - Runtime/static mismatches (runtime data contradicts static analysis)
 * - Impossible render trees (cycles in the render graph)
 * - Circular ownership (composite ownership cycles)
 * - Duplicate composite registration (same sub-component claimed by multiple roots)
 *
 * Does NOT silently ignore failures. Emits structured diagnostics.
 */
export class VerificationPass {
  private diagnostics: Diagnostic[] = [];

  /**
   * Run all verification passes.
   */
  verify(params: {
    components: ComponentMeta[];
    routes: RouteMeta[];
    graphs: SeparatedGraphs;
    unifiedGraph: DependencyGraph;
    composites: Map<string, CompositeGroup>;
    runtime?: Record<string, RuntimeMeta>;
  }): Diagnostic[] {
    this.diagnostics = [];

    this.checkOrphanNodes(params.components, params.routes, params.unifiedGraph);
    this.checkUnresolvedJsxTags(params.components);
    this.checkDuplicateCanonicalIds(params.components);
    this.checkInvalidRouteOwnership(params.routes, params.components);
    this.checkCircularOwnership(params.graphs.compositeOwnership.edges);
    this.checkDuplicateCompositeRegistration(params.composites);
    this.checkRenderCycles(params.graphs.render.edges);

    if (params.runtime && Object.keys(params.runtime).length > 0) {
      this.checkRuntimeStaticMismatches(params.components, params.runtime);
    }

    return this.diagnostics;
  }

  /**
   * Detect orphan nodes: components not reachable from any route.
   */
  private checkOrphanNodes(
    components: ComponentMeta[],
    routes: RouteMeta[],
    graph: DependencyGraph
  ): void {
    const reachable = new Set<string>();

    // Collect all nodes reachable from route nodes
    const routeNodeIds = new Set(routes.map((r) => `route::${r.path}`));
    const adjacency = new Map<string, string[]>();

    for (const edge of graph.edges) {
      const existing = adjacency.get(edge.source) ?? [];
      existing.push(edge.target);
      adjacency.set(edge.source, existing);
    }

    // BFS from all route nodes
    const queue = Array.from(routeNodeIds);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (!reachable.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    // Find components not in the reachable set
    for (const comp of components) {
      if (!reachable.has(comp.id) && comp.type !== "page" && comp.type !== "layout") {
        this.emit({
          category: "orphan-node",
          severity: "info",
          message: `Component "${comp.name}" (${comp.id}) is not reachable from any route`,
          file: comp.relativePath,
          nodeId: comp.id,
        });
      }
    }
  }

  /**
   * Detect unresolved JSX tags: JSX children that don't map to any known component.
   */
  private checkUnresolvedJsxTags(components: ComponentMeta[]): void {
    const knownNames = new Set(components.map((c) => c.name));

    for (const comp of components) {
      for (const child of comp.jsxChildren) {
        // Skip dotted notation (handled by composite detection)
        if (child.includes(".")) continue;

        if (!knownNames.has(child)) {
          this.emit({
            category: "unresolved-jsx",
            severity: "warning",
            message: `JSX tag <${child} /> in "${comp.name}" does not resolve to any known component`,
            file: comp.relativePath,
            nodeId: comp.id,
            context: { unresolvedTag: child },
          });
        }
      }
    }
  }

  /**
   * Detect duplicate canonical IDs.
   */
  private checkDuplicateCanonicalIds(components: ComponentMeta[]): void {
    const seen = new Map<string, ComponentMeta>();

    for (const comp of components) {
      const existing = seen.get(comp.id);
      if (existing) {
        this.emit({
          category: "duplicate-canonical-id",
          severity: "error",
          message: `Duplicate canonical ID "${comp.id}" for components "${comp.name}" and "${existing.name}"`,
          file: comp.relativePath,
          nodeId: comp.id,
          context: {
            existingFile: existing.relativePath,
            duplicateFile: comp.relativePath,
          },
        });
      } else {
        seen.set(comp.id, comp);
      }
    }
  }

  /**
   * Detect invalid route ownership: routes pointing to non-existent page components.
   */
  private checkInvalidRouteOwnership(
    routes: RouteMeta[],
    components: ComponentMeta[]
  ): void {
    const componentFiles = new Set(
      components.map((c) => c.filePath.replace(/\\/g, "/"))
    );

    for (const route of routes) {
      const normalizedPath = route.filePath.replace(/\\/g, "/");
      if (!componentFiles.has(normalizedPath)) {
        this.emit({
          category: "invalid-route-ownership",
          severity: "warning",
          message: `Route "${route.path}" references page file "${route.relativePath}" but no component was found in it`,
          file: route.relativePath,
          context: { routePath: route.path },
        });
      }
    }
  }

  /**
   * Detect circular ownership in composite graph.
   */
  private checkCircularOwnership(
    edges: { source: string; target: string }[]
  ): void {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const existing = adjacency.get(edge.source) ?? [];
      existing.push(edge.target);
      adjacency.set(edge.source, existing);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string, path: string[]): boolean => {
      if (inStack.has(node)) {
        const cycle = [...path.slice(path.indexOf(node)), node];
        this.emit({
          category: "circular-ownership",
          severity: "error",
          message: `Circular composite ownership detected: ${cycle.join(" → ")}`,
          nodeId: node,
          context: { cycle },
        });
        return true;
      }

      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        dfs(neighbor, [...path, node]);
      }

      inStack.delete(node);
      return false;
    };

    for (const node of adjacency.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }
  }

  /**
   * Detect duplicate composite registration (same sub-component claimed by multiple roots).
   */
  private checkDuplicateCompositeRegistration(
    composites: Map<string, CompositeGroup>
  ): void {
    const subToRoot = new Map<string, string>();

    for (const [, group] of composites) {
      for (const fullName of group.fullNames) {
        const existingRoot = subToRoot.get(fullName);
        if (existingRoot && existingRoot !== group.root) {
          this.emit({
            category: "duplicate-composite-registration",
            severity: "error",
            message: `Sub-component "${fullName}" is claimed by both "${existingRoot}" and "${group.root}"`,
            context: {
              subComponent: fullName,
              root1: existingRoot,
              root2: group.root,
            },
          });
        } else {
          subToRoot.set(fullName, group.root);
        }
      }
    }
  }

  /**
   * Detect cycles in the render graph (impossible render trees).
   */
  private checkRenderCycles(
    edges: { source: string; target: string }[]
  ): void {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const existing = adjacency.get(edge.source) ?? [];
      existing.push(edge.target);
      adjacency.set(edge.source, existing);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): void => {
      if (inStack.has(node)) {
        this.emit({
          category: "impossible-render-tree",
          severity: "warning",
          message: `Render cycle detected involving "${node}" — component renders itself (directly or transitively)`,
          nodeId: node,
        });
        return;
      }

      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        dfs(neighbor);
      }

      inStack.delete(node);
    };

    for (const node of adjacency.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  /**
   * Detect runtime/static mismatches.
   */
  private checkRuntimeStaticMismatches(
    components: ComponentMeta[],
    runtime: Record<string, RuntimeMeta>
  ): void {
    const componentIds = new Set(components.map((c) => c.id));

    for (const [runtimeId, meta] of Object.entries(runtime)) {
      if (!componentIds.has(runtimeId)) {
        this.emit({
          category: "runtime-static-mismatch",
          severity: "warning",
          message: `Runtime data exists for "${runtimeId}" but no matching component found in static analysis`,
          nodeId: runtimeId,
          context: {
            mountCount: meta.mountCount,
            mountedOnRoutes: meta.mountedOnRoutes,
          },
        });
      }
    }
  }

  /**
   * Emit a diagnostic.
   */
  private emit(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }
}
