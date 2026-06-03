import { createHash } from "node:crypto";

export interface AnalysisPass {
  readonly id: string;
  readonly stage: "build-ir" | "analyze" | "verify" | "emit-prep";
  /**
   * IDs of passes that must complete before this one. The {@link PassManager}
   * topologically sorts on this DAG; ties are broken by `(stage, id)` to keep
   * scheduling deterministic for byte-identical outputs.
   */
  readonly dependsOn?: readonly string[];
  run(): Promise<void>;
}

export interface PassExecutionRecord {
  passId: string;
  stage: AnalysisPass["stage"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  deterministicOrderKey: string;
}

/**
 * Thrown when {@link PassManager.runAll} cannot produce a valid execution order
 * because the registered passes form a cycle or reference an unknown dependency.
 */
export class PassScheduleError extends Error {
  constructor(message: string, readonly cycle?: readonly string[]) {
    super(message);
    this.name = "PassScheduleError";
  }
}

const STAGE_ORDER: AnalysisPass["stage"][] = ["build-ir", "analyze", "verify", "emit-prep"];

/**
 * Schedules and runs analysis passes.
 *
 * Resolution algorithm:
 *   1. Validate that every `dependsOn` ID refers to a registered pass.
 *   2. Perform a Kahn-style topological sort keyed by
 *      `(stage-index, id)` to guarantee deterministic order across runs
 *      and platforms (no Map iteration order surprises).
 *   3. Detect cycles up-front and surface them as {@link PassScheduleError}.
 *
 * Passes within an independent component run sequentially today; this is the
 * scheduling foundation that a future worker pool (RFC-001 \u00a79.1) will exploit
 * to run independent passes in parallel.
 */
export class PassManager {
  private passes: AnalysisPass[] = [];
  private ledger: PassExecutionRecord[] = [];

  register(pass: AnalysisPass): void {
    if (this.passes.some((p) => p.id === pass.id)) {
      throw new PassScheduleError(`Duplicate pass id: "${pass.id}"`);
    }
    this.passes.push(pass);
  }

  /** Returns the topologically sorted execution order without running anything. */
  plan(): AnalysisPass[] {
    return this.topologicalSort(this.passes);
  }

  async runAll(): Promise<void> {
    const sorted = this.topologicalSort(this.passes);

    for (const pass of sorted) {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      await pass.run();
      const finishedAt = new Date().toISOString();
      this.ledger.push({
        passId: pass.id,
        stage: pass.stage,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startMs,
        deterministicOrderKey: createHash("sha256")
          .update(`${pass.stage}:${pass.id}`)
          .digest("hex"),
      });
    }
  }

  getLedger(): readonly PassExecutionRecord[] {
    return [...this.ledger];
  }

  /**
   * Kahn's algorithm with deterministic tie-breaking by `(stage, id)`.
   * Throws {@link PassScheduleError} on cycles or missing dependencies.
   */
  private topologicalSort(passes: AnalysisPass[]): AnalysisPass[] {
    const byId = new Map(passes.map((p) => [p.id, p]));
    const inDegree = new Map<string, number>();
    const reverse = new Map<string, string[]>(); // dep -> dependents

    for (const pass of passes) {
      inDegree.set(pass.id, 0);
    }

    for (const pass of passes) {
      for (const dep of pass.dependsOn ?? []) {
        if (!byId.has(dep)) {
          throw new PassScheduleError(
            `Pass "${pass.id}" depends on unknown pass "${dep}"`
          );
        }
        inDegree.set(pass.id, (inDegree.get(pass.id) ?? 0) + 1);
        const list = reverse.get(dep) ?? [];
        list.push(pass.id);
        reverse.set(dep, list);
      }
    }

    const compare = (a: AnalysisPass, b: AnalysisPass): number => {
      const sa = STAGE_ORDER.indexOf(a.stage);
      const sb = STAGE_ORDER.indexOf(b.stage);
      if (sa !== sb) return sa - sb;
      return a.id.localeCompare(b.id);
    };

    const ready: AnalysisPass[] = passes
      .filter((p) => (inDegree.get(p.id) ?? 0) === 0)
      .sort(compare);

    const sorted: AnalysisPass[] = [];
    while (ready.length > 0) {
      const next = ready.shift()!;
      sorted.push(next);
      for (const dependentId of reverse.get(next.id) ?? []) {
        const remaining = (inDegree.get(dependentId) ?? 0) - 1;
        inDegree.set(dependentId, remaining);
        if (remaining === 0) {
          const dependentPass = byId.get(dependentId)!;
          // Insert in deterministic order.
          let inserted = false;
          for (let i = 0; i < ready.length; i++) {
            if (compare(dependentPass, ready[i]!) < 0) {
              ready.splice(i, 0, dependentPass);
              inserted = true;
              break;
            }
          }
          if (!inserted) ready.push(dependentPass);
        }
      }
    }

    if (sorted.length !== passes.length) {
      const remaining = passes.filter((p) => !sorted.includes(p)).map((p) => p.id);
      throw new PassScheduleError(
        `Cycle detected in pass dependencies; could not schedule: ${remaining.join(", ")}`,
        remaining
      );
    }

    return sorted;
  }
}
