/** Skip ticks while a read is outstanding; stopping also fences late results. */
export function startSerialPoll(work: (stopped: () => boolean) => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void Promise.resolve()
      .then(() => { if (!stopped) return work(() => stopped); })
      .catch(() => { /* The next tick may retry; detached errors cannot escape. */ })
      .finally(() => { inFlight = false; });
  }, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
