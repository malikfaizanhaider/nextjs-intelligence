export { ComponentAnalyzer } from "./component-analyzer";
export type { ParseFailure } from "./component-analyzer";
export { detectRoutes } from "./route-detector";
export { detectApiRoutes, detectMiddleware } from "./api-route-detector";
export { detectParallelSlots } from "./parallel-slot-detector";
export { ServerActionDetector } from "./server-action-detector";
export { classifyComponent, containsProviderPattern, DEFAULT_CLASSIFICATION_RULES } from "./classifier";
export { GraphBuilder } from "./graph-builder";
export { RecursiveTraverser, InMemoryTraversalCache } from "./recursive-traverser";
export type { TraversalCache, ResolvedDependency, TraversalResult } from "./recursive-traverser";
export { SearchParamsAnalyzer } from "./search-params-analyzer";
export { RouteIntelligenceBuilder } from "./route-intelligence-builder";
export { CompositeDetector } from "./composite-detector";
export { SymbolResolver } from "./symbol-resolver";
export { Canonicalizer } from "./canonicalizer";
export { VerificationPass } from "./verification";
export { BuildOutputAnalyzer } from "./build-output-analyzer";
export type {
  BuildOutputAnalysis,
  BuildOutputRouteInfo,
  BuildOutputServerAction,
  BuildOutputClientBoundary,
  BuildOutputMiddleware,
} from "./build-output-analyzer";
