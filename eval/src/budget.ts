export class BudgetLedger {
  private committed = 0; private reserved = new Map<string, number>();
  constructor(readonly capUsd: number, readonly stopFraction = 0.8) {
    if (!Number.isFinite(capUsd) || capUsd < 0) throw new Error("cap must be finite and >= 0");
    if (!Number.isFinite(stopFraction) || stopFraction <= 0 || stopFraction > 1) throw new Error("stop fraction must be in (0, 1]");
  }
  get incurred() { return this.committed; }
  get outstanding() { return [...this.reserved.values()].reduce((a, b) => a + b, 0); }
  /** Reserve the MAXIMUM cost of the next request before sending it. Refuses at the stop threshold. */
  reserve(id: string, maxUsd: number): boolean {
    if (!Number.isFinite(maxUsd) || maxUsd < 0) throw new Error("reservation must be finite and >= 0");
    if (this.reserved.has(id)) throw new Error(`duplicate reservation ${id}`);
    if (this.committed + this.outstanding + maxUsd > this.capUsd * this.stopFraction) return false;
    this.reserved.set(id, maxUsd); return true;
  }
  settle(id: string, actualUsd: number) {
    if (!this.reserved.has(id)) throw new Error(`no reservation ${id}`);
    if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("cost must be finite and >= 0");
    const reserved = this.reserved.get(id)!;
    this.reserved.delete(id); this.committed += actualUsd;
    if (actualUsd > reserved) throw new Error("provider cost exceeded the reserved maximum; stop the run");
  }
}

