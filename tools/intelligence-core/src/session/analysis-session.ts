import type { AnalyzerConfig, IntelligenceManifest } from "../../../intelligence-types/src/index";
import { runIntelligencePipelineInternal } from "../pipeline";
import { InMemoryDiagnosticsStore, type DiagnosticsStore } from "./diagnostics-store";
import { InMemoryIRStore, type IRStore } from "../ir/ir-store";
import { PassManager } from "../passes/pass-manager";
import { SessionState } from "./session-state";
import { IntelligenceRegistry } from "../registry";
import { RegistryAdapter } from "./registry-adapter";

export interface AnalysisSessionOptions {
  config: AnalyzerConfig;
  registry?: IntelligenceRegistry;
  diagnosticsStore?: DiagnosticsStore;
  irStore?: IRStore;
  passManager?: PassManager;
}

export class AnalysisSession {
  readonly state = new SessionState();

  readonly registry: IntelligenceRegistry;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly irStore: IRStore;
  readonly passManager: PassManager;

  private config: AnalyzerConfig;

  constructor(options: AnalysisSessionOptions) {
    this.config = options.config;
    this.registry = RegistryAdapter.resolve(options.registry);
    this.diagnosticsStore = options.diagnosticsStore ?? new InMemoryDiagnosticsStore();
    this.irStore = options.irStore ?? new InMemoryIRStore();
    this.passManager = options.passManager ?? new PassManager();
  }

  async run(): Promise<IntelligenceManifest> {
    this.state.transitionTo("initialized");
    this.state.transitionTo("ir-built");
    this.state.transitionTo("passes-executed");
    this.state.transitionTo("verified");

    const manifest = await runIntelligencePipelineInternal(this.config, this.registry, this.diagnosticsStore);

    this.state.transitionTo("emitted");
    return manifest;
  }

  dispose(): void {
    this.diagnosticsStore.clear();
    this.irStore.clear();
    this.state.transitionTo("disposed");
  }
}
