import type { AnalyzerConfig, IntelligenceManifest } from "../../../intelligence-types/src/index";
import { runIntelligencePipelineInternal, type PipelineRunResult } from "../pipeline";
import { InMemoryDiagnosticsStore, type DiagnosticsStore } from "./diagnostics-store";
import { InMemoryIRStore, type IRStore } from "../ir/ir-store";
import { PassManager } from "../passes/pass-manager";
import { SessionState } from "./session-state";
import { IntelligenceRegistry } from "../registry";
import { RegistryAdapter } from "./registry-adapter";
import { consoleLogger, type Logger } from "../logger";

export interface AnalysisSessionOptions {
  config: AnalyzerConfig;
  registry?: IntelligenceRegistry;
  diagnosticsStore?: DiagnosticsStore;
  irStore?: IRStore;
  passManager?: PassManager;
  logger?: Logger;
}

export class AnalysisSession {
  readonly state = new SessionState();

  readonly registry: IntelligenceRegistry;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly irStore: IRStore;
  readonly passManager: PassManager;
  readonly logger: Logger;

  private config: AnalyzerConfig;

  constructor(options: AnalysisSessionOptions) {
    this.config = options.config;
    this.registry = RegistryAdapter.resolve(options.registry);
    this.diagnosticsStore = options.diagnosticsStore ?? new InMemoryDiagnosticsStore();
    this.irStore = options.irStore ?? new InMemoryIRStore();
    this.passManager = options.passManager ?? new PassManager();
    this.logger = options.logger ?? consoleLogger;
  }

  async run(): Promise<IntelligenceManifest> {
    const { manifest } = await this.runDetailed();
    return manifest;
  }

  async runDetailed(): Promise<PipelineRunResult> {
    this.state.transitionTo("initialized");
    this.state.transitionTo("ir-built");
    this.state.transitionTo("passes-executed");
    this.state.transitionTo("verified");

    const result = await runIntelligencePipelineInternal(
      this.config,
      this.registry,
      this.diagnosticsStore,
      this.logger
    );

    this.state.transitionTo("emitted");
    return result;
  }

  dispose(): void {
    this.diagnosticsStore.clear();
    this.irStore.clear();
    this.state.transitionTo("disposed");
  }
}
