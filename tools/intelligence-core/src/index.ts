export { IntelligenceRegistry } from "./registry";
export {
  runIntelligencePipeline,
  runIntelligencePipelineDetailed,
  runIntelligencePipelineInternal,
} from "./pipeline";
export type { PipelineRunOptions, PipelineRunResult } from "./pipeline";
export { consoleLogger, silentLogger } from "./logger";
export type { Logger } from "./logger";
export { loadConfigFile, mergeConfigs } from "./config-loader";
export type { ConfigLoadResult } from "./config-loader";
export { OutputWriter } from "./output-writer";
export { IncrementalCache } from "./cache";
export { diffManifests, formatManifestDiff } from "./manifest-diff";
export type { ManifestDiff } from "./manifest-diff";
export { deriveMetrics, loadBundleStats } from "./derived-metrics";
export {
  ComponentAnalyzer,
  detectRoutes,
  detectApiRoutes,
  detectMiddleware,
  detectParallelSlots,
  ServerActionDetector,
  classifyComponent,
  containsProviderPattern,
  GraphBuilder,
  DEFAULT_CLASSIFICATION_RULES,
  RecursiveTraverser,
  InMemoryTraversalCache,
  SearchParamsAnalyzer,
  RouteIntelligenceBuilder,
  CompositeDetector,
  SymbolResolver,
  Canonicalizer,
  VerificationPass,
} from "./analyzer/index";
export type { ParseFailure, TraversalCache, ResolvedDependency, TraversalResult } from "./analyzer/index";

export { AnalysisSession } from "./session/analysis-session";
export { SessionState } from "./session/session-state";
export { PassManager, PassScheduleError } from "./passes/pass-manager";
export type { AnalysisPass, PassExecutionRecord } from "./passes/pass-manager";
export { InMemoryDiagnosticsStore } from "./session/diagnostics-store";
export { InMemoryIRStore } from "./ir/ir-store";
export { RegistryAdapter } from "./session/registry-adapter";

export { startMcpServer, IntelligenceAnalysisService } from "./mcp/index";
export type { McpAnalysisOptions, DependencyGraphResult, ImpactAnalysisResult } from "./mcp/index";
