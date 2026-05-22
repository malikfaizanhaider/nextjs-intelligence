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
