// Generic "keep trying?" loop for long-running BLE operations whose duration
// depends on a scale's configurable heartbeat (10s-300s) rather than a fixed
// constant. Each round is a single bounded attempt; if it doesn't succeed we
// ask the caller (via `confirm`) whether to run another round, rather than
// silently blocking for an unbounded time or giving up too early.

export interface RoundResult {
  found: boolean;
}

/**
 * Repeatedly run `attempt` (one bounded round) until it succeeds (`found`) or
 * the caller declines to continue. `confirm` is invoked between rounds to ask
 * the user whether to keep waiting — it resolves true to run another round.
 */
export async function withContinuePrompts<T extends RoundResult>(
  attempt: () => Promise<T>,
  confirm: () => Promise<boolean>,
): Promise<T> {
  for (;;) {
    const res = await attempt();
    if (res.found) return res;
    const keepGoing = await confirm();
    if (!keepGoing) return res;
  }
}
