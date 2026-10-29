import type { ProSession } from "./model.ts";

/** One active snapshot plus one latest confirmed revision per queued page.
 * Intermediate saves never retain an unbounded queue of Blob/metadata roots. */
export class CheckpointQueue<T> {
  private pending = new Map<string, ProSession>();
  private draining = false;
  private waiters: (() => void)[] = [];
  private write: (session: ProSession) => Promise<T>;
  private settled: (
    session: ProSession,
    result: { value: T } | { error: unknown },
    more: boolean,
  ) => void;
  constructor(write: (session: ProSession) => Promise<T>, settled: CheckpointQueue<T>["settled"]) {
    this.write = write;
    this.settled = settled;
  }
  enqueue(session: ProSession) {
    if (!this.pending.has(session.document.panelId) && this.pending.size >= 8)
      throw Error(
        "Recovery queue is busy. The primary draft is saved; retry its checkpoint after processing finishes.",
      );
    this.pending.set(session.document.panelId, session);
    if (!this.draining) {
      this.draining = true;
      void this.drain();
    }
  }
  private async drain() {
    while (this.pending.size) {
      const [id, session] = this.pending.entries().next().value!;
      this.pending.delete(id);
      let result: { value: T } | { error: unknown };
      try {
        result = { value: await this.write(session) };
      } catch (error) {
        result = { error };
      }
      this.settled(session, result, this.pending.has(id));
    }
    this.draining = false;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
  flush() {
    return !this.draining
      ? Promise.resolve()
      : new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
