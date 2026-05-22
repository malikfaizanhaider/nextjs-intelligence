import { resolve, relative } from "node:path";
import type { Project } from "ts-morph";
import type {
  RouteMeta,
  RouteIntelligence,
  ComponentMeta,
  ComponentUsageMap,
  SearchParamUsage,
  RouteComplexity,
} from "../../../intelligence-types/src/index";
import { isBuiltinHook } from "../../../intelligence-types/src/index";
import { RecursiveTraverser } from "./recursive-traverser";
import { SearchParamsAnalyzer } from "./search-params-analyzer";
import type { CompositeGroup } from "./composite-detector";
import { Canonicalizer, type CanonicalizationResult } from "./canonicalizer";

/**
 * Result of route intelligence analysis.
 */
export interface RouteIntelligenceResult {
  /** Route intelligence keyed by route path */
  routeIntelligence: Record<string, RouteIntelligence>;
  /** Component usage across routes */
  componentUsage: ComponentUsageMap;
  /** Updated components with usedInRoutes populated */
  updatedComponents: ComponentMeta[];
}

/**
 * Builds complete route intelligence by:
 * 1. Taking each route's page.tsx (+ layout, template, etc.)
 * 2. Recursively traversing the entire dependency tree
 * 3. Classifying all discovered dependencies
 * 4. Detecting search params and dynamic params
 * 5. Computing complexity metrics
 * 6. Collapsing composite sub-components via canonicalization
 *
 * ROOT ENTITY = ROUTE. Every dependency belongs to a route tree.
 * All identities are CANONICAL (identity-based, not name-based).
 */
export class RouteIntelligenceBuilder {
  private project: Project;
  private projectRoot: string;
  private components: Map<string, ComponentMeta>;
  private composites: Map<string, CompositeGroup>;
  private canonicalization: CanonicalizationResult;

  constructor(
    project: Project,
    projectRoot: string,
    components: ComponentMeta[],
    composites?: Map<string, CompositeGroup>
  ) {
    this.project = project;
    this.projectRoot = projectRoot;
    this.components = new Map(components.map((c) => [c.relativePath, c]));
    this.composites = composites ?? new Map();

    // Run canonicalization to get normalized lookup maps
    this.canonicalization = Canonicalizer.canonicalize(components, this.composites);
  }

  /**
   * Build intelligence for all routes.
   */
  build(routes: RouteMeta[], allComponents: ComponentMeta[]): RouteIntelligenceResult {
    const routeIntelligence: Record<string, RouteIntelligence> = {};
    const componentUsage: ComponentUsageMap = {};
    const componentsByName = new Map<string, ComponentMeta>();
    const componentsByCanonicalId = new Map<string, ComponentMeta>();

    for (const comp of allComponents) {
      componentsByName.set(comp.name, comp);
      componentsByCanonicalId.set(comp.id, comp);
    }

    for (const route of routes) {
      const intelligence = this.analyzeRoute(route, allComponents);
      routeIntelligence[route.path] = intelligence;

      // Build component usage map using canonical names
      for (const compName of intelligence.components) {
        const canonicalId = this.canonicalization.nameToCanonicalId.get(compName);
        const key = canonicalId ?? compName;

        if (!componentUsage[key]) {
          const meta = componentsByName.get(compName);
          componentUsage[key] = {
            usedInRoutes: [],
            usageCount: 0,
            type: meta?.type ?? "component",
            filePath: meta?.relativePath ?? "",
          };
        }
        const usage = componentUsage[key]!;
        if (!usage.usedInRoutes.includes(route.path)) {
          usage.usedInRoutes.push(route.path);
        }
        usage.usageCount++;
      }
    }

    // Update components with usedInRoutes
    const updatedComponents = allComponents.map((comp) => {
      const usage = componentUsage[comp.id] ?? componentUsage[comp.name];
      if (usage) {
        return {
          ...comp,
          usedInRoutes: usage.usedInRoutes,
          isReusable: usage.usedInRoutes.length > 1 || comp.isReusable,
        };
      }
      return comp;
    });

    return { routeIntelligence, componentUsage, updatedComponents };
  }

  /**
   * Analyze a single route: build complete dependency tree.
   */
  private analyzeRoute(route: RouteMeta, allComponents: ComponentMeta[]): RouteIntelligence {
    const rootFiles = this.getRouteRootFiles(route);

    // Recursive traversal from all root files
    const traverser = new RecursiveTraverser(this.project, this.projectRoot);
    const traversal = traverser.traverseMultiple(rootFiles);

    // Search params analysis across all files in the dependency tree
    const allFilePaths = Array.from(traversal.allFiles).map((f) =>
      resolve(this.projectRoot, f)
    );
    const spAnalyzer = new SearchParamsAnalyzer(this.project, this.projectRoot);
    const spResult = spAnalyzer.analyzeFiles(allFilePaths);

    // Extract dynamic params from route path itself
    const routePathParams = SearchParamsAnalyzer.extractParamsFromRoutePath(route.path);
    const dynamicParams = [...new Set([...routePathParams, ...spResult.dynamicParams])];

    // Classify discovered components by type, using canonical identities
    const dialogs: string[] = [];
    const grids: string[] = [];
    const charts: string[] = [];
    const providers: string[] = [];
    const components: string[] = [];

    // Use the componentNames from traversal for matching
    const traversalComponentNames = traversal.componentNames ?? traversal.components;

    for (const comp of allComponents) {
      if (traversalComponentNames.has(comp.name) || traversal.allFiles.has(comp.relativePath)) {
        // Skip composite sub-components — they collapse to their root
        if (Canonicalizer.isSubComponent(comp.name, this.canonicalization)) continue;

        components.push(comp.name);
        switch (comp.type) {
          case "dialog":
            dialogs.push(comp.name);
            break;
          case "grid":
            grids.push(comp.name);
            break;
          case "chart":
            charts.push(comp.name);
            break;
          case "provider":
            providers.push(comp.name);
            break;
        }
      }
    }

    // Also check traversal-discovered providers (from naming convention)
    for (const providerName of traversal.providers) {
      if (!providers.includes(providerName)) {
        providers.push(providerName);
      }
    }

    // Handle dotted JSX usage: add composite root if sub-component is used
    for (const compName of traversalComponentNames) {
      if (typeof compName === "string" && compName.includes(".")) {
        const rootName = compName.split(".")[0]!;
        if (this.composites.has(rootName) && !components.includes(rootName)) {
          components.push(rootName);
          const rootComp = allComponents.find((c) => c.name === rootName);
          if (rootComp) {
            switch (rootComp.type) {
              case "dialog": if (!dialogs.includes(rootName)) dialogs.push(rootName); break;
              case "grid": if (!grids.includes(rootName)) grids.push(rootName); break;
              case "chart": if (!charts.includes(rootName)) charts.push(rootName); break;
              case "provider": if (!providers.includes(rootName)) providers.push(rootName); break;
            }
          }
        }
      }
    }

    // Build search params record
    const searchParamsRecord: Record<string, SearchParamUsage> = {};
    for (const [key, usage] of spResult.searchParams) {
      searchParamsRecord[key] = usage;
    }

    // Compute all dependencies
    const allDeps = new Set<string>();
    for (const [, deps] of traversal.dependencies) {
      for (const dep of deps) {
        allDeps.add(dep.exportName);
      }
    }

    const complexity: RouteComplexity = {
      depth: traversal.maxDepth,
      components: components.length,
      dependencies: allDeps.size,
    };

    const relPath = relative(this.projectRoot, route.filePath).replace(/\\/g, "/");

    return {
      path: route.path,
      filePath: route.filePath,
      relativePath: relPath,
      segmentType: route.segmentType,
      searchParams: searchParamsRecord,
      dynamicParams,
      components: this.sortUnique(components),
      hooks: this.sortUnique(Array.from(traversal.hooks).filter((h) => !isBuiltinHook(h))),
      utils: this.sortUnique(Array.from(traversal.utils)),
      providers: this.sortUnique(providers),
      dialogs: this.sortUnique(dialogs),
      grids: this.sortUnique(grids),
      charts: this.sortUnique(charts),
      dependencies: this.sortUnique(Array.from(allDeps)),
      dependencyCount: allDeps.size,
      complexity,
      layoutFilePath: route.layoutFilePath,
      loadingFilePath: route.loadingFilePath,
      errorFilePath: route.errorFilePath,
      templateFilePath: route.templateFilePath,
      isRouteGroup: route.isRouteGroup,
      parentRoute: route.parentRoute,
    };
  }

  /**
   * Get all root files for a route (page + associated special files).
   */
  private getRouteRootFiles(route: RouteMeta): string[] {
    const files: string[] = [route.filePath.replace(/\\/g, "/")];

    if (route.layoutFilePath) {
      files.push(route.layoutFilePath.replace(/\\/g, "/"));
    }
    if (route.templateFilePath) {
      files.push(route.templateFilePath.replace(/\\/g, "/"));
    }
    if (route.loadingFilePath) {
      files.push(route.loadingFilePath.replace(/\\/g, "/"));
    }
    if (route.errorFilePath) {
      files.push(route.errorFilePath.replace(/\\/g, "/"));
    }

    return files;
  }

  private sortUnique(arr: string[]): string[] {
    return [...new Set(arr)].sort();
  }
}
