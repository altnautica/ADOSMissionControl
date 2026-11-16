/**
 * @module input/pilot-hb
 * @description The pilot stream's 1 Hz `hb`, timed by a dedicated Web Worker.
 *
 * Why a Worker. The pilot runs its link-loss timer per surface instance. A
 * browser throttles the timers of a hidden page (aligned to 1 s at first,
 * then to about once a minute after some minutes hidden), so a page timer
 * would let an observer tab that is only hidden fall silent and trigger a
 * spurious return. A dedicated Worker's timers are not throttled with the
 * page [INFERENCE: current Chromium, Firefox and Safari behaviour].
 *
 * The send path. A Worker cannot send on the main thread's WebSocket, and a
 * second socket per tab would add a pilot connection for nothing. So the
 * Worker owns the timing and posts `hb` over its message channel, and the
 * main thread's `onmessage` sends it on the pilot socket. Message delivery
 * from a Worker is an ordinary task, not a timer task, so a hidden page's
 * timer throttling does not delay it, and `WebSocket.send` itself is not
 * throttled. Only a main thread that cannot run tasks at all (a hang, a
 * frozen or discarded page) stops the send, and then no control in the tab
 * is reachable either, so going silent is the right answer.
 *
 * The liveness gate. While this tab holds the stick session, a silence must
 * mean the operator lost the controls. The main thread posts a `tick` every
 * {@link PILOT_TICK_MS} from its own (throttled) timer, and the Worker sends
 * `hb` only while the last tick is under {@link PILOT_TICK_FRESH_MS} old. A
 * stalled or long-hidden operator tab therefore stops its `hb` and the
 * pilot's link-loss action follows. An observer tab sends the plain `hb`.
 * @license GPL-3.0-only
 */

import {
  PILOT_TICK_MS,
  runPilotHbLoop,
  type HbFromWorker,
  type HbToWorker,
  type HbWorkerScope,
} from "./pilot-hb-loop";

export { PILOT_TICK_MS, PILOT_TICK_FRESH_MS, PILOT_HB_MS } from "./pilot-hb-loop";

/** The main-thread side of the channel (a `Worker`). */
interface HbPort {
  postMessage: (msg: HbToWorker) => void;
  onmessage: ((e: { data: HbFromWorker }) => void) | null;
  terminate: () => void;
}

/** The loop on this thread, where no Worker exists (tests). */
function inlinePort(): HbPort {
  const port: HbPort = {
    onmessage: null,
    postMessage: (msg) => scope.onmessage?.({ data: msg }),
    terminate: () => {},
  };
  const scope: HbWorkerScope = {
    onmessage: null,
    postMessage: (msg) => port.onmessage?.({ data: msg }),
  };
  runPilotHbLoop(scope);
  return port;
}

function openPort(): HbPort {
  if (typeof Worker === "undefined") return inlinePort();
  return new Worker(new URL("./pilot-hb-worker.ts", import.meta.url), { type: "module" }) as unknown as HbPort;
}

export interface PilotHeartbeat {
  /** Whether this tab holds the stick session (gates `hb` on main-thread ticks). */
  setHolder: (holder: boolean) => void;
  stop: () => void;
}

/** Start the Worker-timed heartbeat; `onHb` runs on the main thread once per beat. */
export function startPilotHeartbeat(onHb: () => void): PilotHeartbeat {
  const port = openPort();
  port.onmessage = (e) => {
    if (e.data.t === "hb") onHb();
  };
  const tick = () => port.postMessage({ t: "tick" });
  tick();
  const ticker = setInterval(tick, PILOT_TICK_MS);
  let holder = false;
  return {
    setHolder: (next) => {
      if (next === holder) return;
      holder = next;
      port.postMessage({ t: "holder", holder: next });
    },
    stop: () => {
      clearInterval(ticker);
      port.postMessage({ t: "stop" });
      port.onmessage = null;
      port.terminate();
    },
  };
}
