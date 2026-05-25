export { IntelligenceRegistry } from "./registry";
export { runIntelligencePipeline } from "./pipeline";
export { OutputWriter } from "./output-writer";
export { IncrementalCache } from "./cache";
export {
  ComponentAnalyzer,
  detectRoutes,
  classifyComponent,
  containsProviderPattern,
  GraphBuilder,
  DEFAULT_CLASSIFICATION_RULES,
  RecursiveTraverser,
  SearchParamsAnalyzer,
  RouteIntelligenceBuilder,
  CompositeDetector,
  SymbolResolver,
  Canonicalizer,
  VerificationPass,
} from "./analyzer/index";

export { AnalysisSession } from "./session/analysis-session";
export { SessionState } from "./session/session-state";
export { PassManager } from "./passes/pass-manager";
export { InMemoryDiagnosticsStore } from "./session/diagnostics-store";
export { InMemoryIRStore } from "./ir/ir-store";
export { RegistryAdapter } from "./session/registry-adapter";
