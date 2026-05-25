import { createHash } from "node:crypto";

export interface AnalysisPass {
  readonly id: string;
  readonly stage: "build-ir" | "analyze" | "verify" | "emit-prep";
  run(): Promise<void>;
}

export interface PassExecutionRecord {
  passId: string;
  stage: AnalysisPass["stage"];
  startedAt: string;
  finishedAt: string;
  deterministicOrderKey: string;
}

export class PassManager {
  private passes: AnalysisPass[] = [];
  private ledger: PassExecutionRecord[] = [];

  register(pass: AnalysisPass): void {
    this.passes.push(pass);
  }

  async runAll(): Promise<void> {
    const sorted = [...this.passes].sort((a, b) => {
      if (a.stage !== b.stage) return a.stage.localeCompare(b.stage);
      return a.id.localeCompare(b.id);
    });

    for (const pass of sorted) {
      const startedAt = new Date().toISOString();
      await pass.run();
      const finishedAt = new Date().toISOString();
      this.ledger.push({
        passId: pass.id,
        stage: pass.stage,
        startedAt,
        finishedAt,
        deterministicOrderKey: createHash("sha256").update(`${pass.stage}:${pass.id}`).digest("hex"),
      });
    }
  }

  getLedger(): readonly PassExecutionRecord[] {
    return [...this.ledger];
  }
}
