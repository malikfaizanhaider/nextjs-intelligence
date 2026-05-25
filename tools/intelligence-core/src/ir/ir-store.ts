export type IRKind = "ast" | "semantic" | "graph" | "manifest";
export type SnapshotId = string;

export interface IRWriteHandle<T = unknown> {
  readonly kind: IRKind;
  readonly passId: string;
  set(data: T): void;
  commit(): SnapshotId;
}

export interface IRStore {
  beginWrite<T = unknown>(kind: IRKind, passId: string): IRWriteHandle<T>;
  getSnapshot<T = unknown>(id: SnapshotId): T | undefined;
  getLatestSnapshotId(kind: IRKind): SnapshotId | undefined;
  clear(): void;
}

export class InMemoryIRStore implements IRStore {
  private snapshots = new Map<SnapshotId, unknown>();
  private latestByKind = new Map<IRKind, SnapshotId>();
  private counters = new Map<IRKind, number>();

  beginWrite<T = unknown>(kind: IRKind, passId: string): IRWriteHandle<T> {
    let buffer: T | undefined;

    return {
      kind,
      passId,
      set(data: T) {
        buffer = data;
      },
      commit: () => {
        const nextCounter = (this.counters.get(kind) ?? 0) + 1;
        this.counters.set(kind, nextCounter);
        const snapshotId = `${kind}:${String(nextCounter).padStart(6, "0")}`;
        this.snapshots.set(snapshotId, buffer);
        this.latestByKind.set(kind, snapshotId);
        return snapshotId;
      },
    };
  }

  getSnapshot<T = unknown>(id: SnapshotId): T | undefined {
    return this.snapshots.get(id) as T | undefined;
  }

  getLatestSnapshotId(kind: IRKind): SnapshotId | undefined {
    return this.latestByKind.get(kind);
  }

  clear(): void {
    this.snapshots.clear();
    this.latestByKind.clear();
    this.counters.clear();
  }
}
