/**
 * @module input/pilot-hb-loop
 * @description The heartbeat Worker's loop: a 1 Hz `hb` posted to the main
 * thread, gated on fresh main-thread ticks while the tab holds the stick
 * session (see pilot-hb for the design). Kept apart from pilot-hb so the
 * Worker chunk never references its own constructor.
 * @license GPL-3.0-only
 */

/** The heartbeat period. */
export const PILOT_HB_MS = 1000;
/** How often the main thread tells the Worker it is alive. */
export const PILOT_TICK_MS = 500;
/** A session-holding tab whose last tick is older than this sends no `hb`. */
export const PILOT_TICK_FRESH_MS = 2000;

/** Main thread to Worker. */
export type HbToWorker = { t: "tick" } | { t: "holder"; holder: boolean } | { t: "stop" };
/** Worker to main thread. */
export type HbFromWorker = { t: "hb" };

/** The Worker side of the channel (the Worker's global scope). */
export interface HbWorkerScope {
  postMessage: (msg: HbFromWorker) => void;
  onmessage: ((e: { data: HbToWorker }) => void) | null;
}

/**
 * Run the loop on `scope` until a `stop` message: every {@link PILOT_HB_MS}
 * post `hb`, except while the tab holds the stick session and its last tick
 * is older than {@link PILOT_TICK_FRESH_MS}.
 */
export function runPilotHbLoop(scope: HbWorkerScope): void {
  let holder = false;
  let lastTick = -Infinity;
  const timer = setInterval(() => {
    if (!holder || Date.now() - lastTick <= PILOT_TICK_FRESH_MS) scope.postMessage({ t: "hb" });
  }, PILOT_HB_MS);
  scope.onmessage = (e) => {
    const msg = e.data;
    if (msg.t === "tick") lastTick = Date.now();
    else if (msg.t === "holder") holder = msg.holder;
    else clearInterval(timer);
  };
}
