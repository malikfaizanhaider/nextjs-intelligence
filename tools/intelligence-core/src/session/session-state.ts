export type SessionLifecycleState =
  | "created"
  | "initialized"
  | "ir-built"
  | "passes-executed"
  | "verified"
  | "emitted"
  | "failed"
  | "disposed";

export class SessionState {
  private state: SessionLifecycleState = "created";

  get current(): SessionLifecycleState {
    return this.state;
  }

  canTransitionTo(next: SessionLifecycleState): boolean {
    const current = this.state;

    if (current === "disposed") {
      return next === "disposed";
    }

    if (next === "failed") return true;
    if (next === "disposed") return true;

    const order: SessionLifecycleState[] = [
      "created",
      "initialized",
      "ir-built",
      "passes-executed",
      "verified",
      "emitted",
    ];

    const fromIndex = order.indexOf(current);
    const toIndex = order.indexOf(next);

    return fromIndex >= 0 && toIndex >= 0 && toIndex === fromIndex + 1;
  }

  transitionTo(next: SessionLifecycleState): void {
    if (!this.canTransitionTo(next)) {
      throw new Error(`Invalid session transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }
}
