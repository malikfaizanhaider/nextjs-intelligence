import type { Diagnostic } from "../../../intelligence-types/src/index";

export interface DiagnosticsStore {
  add(diagnostic: Diagnostic): void;
  addMany(diagnostics: readonly Diagnostic[]): void;
  getAll(): readonly Diagnostic[];
  clear(): void;
}

export class InMemoryDiagnosticsStore implements DiagnosticsStore {
  private diagnostics: Diagnostic[] = [];

  add(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  addMany(diagnostics: readonly Diagnostic[]): void {
    this.diagnostics.push(...diagnostics);
  }

  getAll(): readonly Diagnostic[] {
    return [...this.diagnostics];
  }

  clear(): void {
    this.diagnostics = [];
  }
}
