// Cables between drivers' vehicles, and which browser runs each vehicle. A cable is a stiff
// spring: split across two browsers, each pulling its own end, it would oscillate. So every
// vehicle joined to others by cables, directly or along a chain, is run by one browser, and
// the driver whose vehicle is run elsewhere sends their controls there. No physics in here:
// the server only keeps the list and decides who runs what.
//
// Who runs a group:
// - joining two groups, the browser that ran the bigger one takes the smaller, so as few
//   vehicles as possible change hands; on a tie, the browser of the one that hooked on;
// - when a group comes apart, each part that still holds the running browser's own vehicle
//   stays with it; a lone vehicle goes back to its own driver; any other part goes to the
//   browser of the vehicle at the head of it (pulling, not pulled).

export interface CableLine {
  from: string;
  to: string;
}

export class Towing {
  /** By puller: the vehicle its winch is hooked to, and when (to know the newest). */
  private readonly cables = new Map<string, { to: string; n: number }>();
  /** Vehicles not run by their own driver's browser, and whose browser runs them. */
  private readonly runner = new Map<string, string>();
  private count = 0;

  /** The player whose browser runs this vehicle. */
  runnerOf(vehicle: string): string {
    return this.runner.get(vehicle) ?? vehicle;
  }

  /** The vehicle `from`'s winch is hooked to, if another driver's. */
  hookedTo(from: string): string | undefined {
    return this.cables.get(from)?.to;
  }

  /** `from`'s winch hooked on to `to`; false (and nothing changes) for a cable to itself or one already there. */
  hook(from: string, to: string): boolean {
    if (from === to || this.cables.get(from)?.to === to) return false;
    this.cables.set(from, { to, n: ++this.count });
    this.settle(from);
    return true;
  }

  /** `from`'s winch let go; false if it held no vehicle. */
  unhook(from: string): boolean {
    if (!this.cables.delete(from)) return false;
    this.settle();
    return true;
  }

  /** Every cable on `id`'s vehicle or from it comes off: it is being moved, or has left the road. */
  free(id: string): boolean {
    let changed = false;
    for (const [from, c] of this.cables) {
      if (from === id || c.to === id) {
        this.cables.delete(from);
        changed = true;
      }
    }
    if (changed) this.settle();
    return changed;
  }

  /**
   * `id` has gone: its vehicle's cables come off, and so do the cables of any vehicle its
   * browser ran, since how those winches stood went with it.
   */
  leave(id: string): boolean {
    let changed = false;
    for (const [from, c] of this.cables) {
      if (from === id || c.to === id || this.runnerOf(from) === id) {
        this.cables.delete(from);
        changed = true;
      }
    }
    if (this.runner.delete(id)) changed = true;
    if (changed) this.settle();
    return changed;
  }

  list(): { cables: CableLine[]; runs: { vehicle: string; by: string }[] } {
    return {
      cables: [...this.cables].map(([from, c]) => ({ from, to: c.to })),
      runs: [...this.runner].map(([vehicle, by]) => ({ vehicle, by })),
    };
  }

  /** Works out again who runs what, after the cables changed; `hooked` just hooked on. */
  private settle(hooked?: string): void {
    // The groups: vehicles joined by cables, found by following them both ways.
    const links = new Map<string, string[]>();
    const link = (a: string, b: string): void => {
      links.set(a, [...(links.get(a) ?? []), b]);
    };
    for (const [from, c] of this.cables) {
      link(from, c.to);
      link(c.to, from);
    }
    const before = new Map(this.runner);
    const was = (v: string): string => before.get(v) ?? v;
    this.runner.clear();
    const seen = new Set<string>();
    for (const start of links.keys()) {
      if (seen.has(start)) continue;
      const group: string[] = [];
      const todo = [start];
      seen.add(start);
      while (todo.length) {
        const v = todo.pop()!;
        group.push(v);
        for (const n of links.get(v) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            todo.push(n);
          }
        }
      }
      const by = this.choose(group, was, hooked);
      for (const v of group) if (v !== by) this.runner.set(v, by);
    }
  }

  /** Whose browser runs a group, given who ran its vehicles before. */
  private choose(group: string[], was: (v: string) => string, hooked?: string): string {
    const members = new Set(group);
    // Only a browser whose own vehicle is in the group may run it.
    const counts = new Map<string, number>();
    for (const v of group) {
      const r = was(v);
      if (members.has(r)) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const most = Math.max(0, ...counts.values());
    const best = [...counts].filter(([, n]) => n === most).map(([r]) => r);
    if (best.length === 1) return best[0]!;
    // A tie, or nobody's browser left in the group: the one that just hooked on, else the
    // head of the chain (pulling, not pulled), else the newest puller.
    const towed = new Set([...this.cables.values()].map((c) => c.to));
    const rank = (v: string): number => (v === hooked ? 0 : towed.has(v) ? 2 : 1);
    const pullers = group
      .filter((v) => this.cables.has(v) && (best.length === 0 || best.includes(v)))
      .sort((a, b) => rank(a) - rank(b) || this.cables.get(b)!.n - this.cables.get(a)!.n);
    return pullers[0] ?? best.sort()[0] ?? group.sort()[0]!;
  }
}
