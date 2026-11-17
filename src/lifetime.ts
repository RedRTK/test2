/** Timers this extension owns, so stopping it leaves nothing behind. */
export interface Lifetime {
  readonly stopped: boolean;
  timeout(callback: () => void, ms: number): number;
  wait(ms: number): Promise<void>;
  stop(): void;
}

export function lifetime(): Lifetime {
  const timeouts = new Set<number>();
  const waiting = new Set<() => void>();
  let stopped = false;

  function timeout(callback: () => void, ms: number): number {
    if (stopped) return 0;
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      try {
        callback();
      } catch (error) {
        console.error("[Adblockify] A scheduled task failed.", error);
      }
    }, ms);
    timeouts.add(id);
    return id;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      const done = () => {
        waiting.delete(done);
        resolve();
      };
      waiting.add(done);
      timeout(done, ms);
    });
  }

  function stop(): void {
    stopped = true;
    for (const id of timeouts) window.clearTimeout(id);
    timeouts.clear();
    for (const done of waiting) done();
    waiting.clear();
  }

  return {
    get stopped() {
      return stopped;
    },
    timeout,
    wait,
    stop,
  };
}
