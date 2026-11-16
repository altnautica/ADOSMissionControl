/**
 * @module input/pilot-hb-worker
 * @description Web Worker that times the pilot stream's `hb` (see pilot-hb
 * for why it runs off the main thread and how the main thread gates it).
 *
 * Bundlers (webpack, turbopack, vite) inline this file as a worker chunk when
 * they see the `new Worker(new URL(...), { type: "module" })` form.
 *
 * @license GPL-3.0-only
 */

import { runPilotHbLoop, type HbWorkerScope } from "./pilot-hb-loop";

runPilotHbLoop(self as unknown as HbWorkerScope);
