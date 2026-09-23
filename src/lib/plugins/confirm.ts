/**
 * Module-level operator-confirmation bridge for non-React plugin handler code.
 *
 * Safety-critical plugin RPCs (command.send, mission.write, vision.designate)
 * must not fire without an explicit operator decision. The handlers run outside
 * the React tree — they are plain functions the postMessage bridge dispatches —
 * so they cannot open a React dialog directly. {@link PluginConfirmHost} wires
 * the live confirm callback once at mount via {@link setPluginConfirmHandler};
 * until then {@link requestPluginConfirm} resolves `denied` so an un-hosted
 * handler DENIES rather than silently proceeding. Mirrors the
 * `setPluginNotifier` singleton in `src/lib/plugins/notifier.ts`.
 *
 * Requests are presented one at a time in arrival order: a new request never
 * replaces or denies the one the operator is reading, it waits its turn. A
 * plugin may hold only one request (queued or showing) at a time; a second one
 * resolves `busy` at once, so no plugin can flood the queue.
 *
 * A presented request is auto-denied after {@link PLUGIN_CONFIRM_TIMEOUT_MS}:
 * the vehicle state the operator is approving against goes stale while a
 * dialog sits open, so an approval long after the prompt is never honoured.
 *
 * @module plugins/confirm
 * @license GPL-3.0-only
 */

/** How long a presented plugin confirmation stays answerable before it auto-denies. */
export const PLUGIN_CONFIRM_TIMEOUT_MS = 30_000;

/**
 * How long the Confirm button stays disabled after a dialog appears, so a
 * click aimed at the previous dialog can never approve the next one.
 */
export const PLUGIN_CONFIRM_ARM_DELAY_MS = 1_000;

export interface PluginConfirmRequest {
  pluginId: string;
  /** Operator-facing name of the drone the action targets. */
  targetName: string;
  /** Device id of the drone the action targets. */
  targetId: string;
  title: string;
  body: string;
  /** Drives the dialog variant. `critical` renders the danger styling. */
  severity?: "warning" | "critical";
}

/**
 * How a confirmation ended: the operator approved, denied (or the window
 * lapsed, or no host is mounted), or the plugin already had a request pending.
 */
export type PluginConfirmOutcome = "approved" | "denied" | "busy";

/**
 * The live confirm callback. `signal` aborts when the request times out so
 * the host can drop the dialog; the host resolves `false` on abort.
 */
type ConfirmHandler = (
  req: PluginConfirmRequest,
  signal: AbortSignal,
) => Promise<boolean>;

interface Queued {
  req: PluginConfirmRequest;
  resolve: (outcome: PluginConfirmOutcome) => void;
}

let handler: ConfirmHandler | null = null;
const queue: Queued[] = [];
/** Plugins holding a queued or presented request. */
const pendingPlugins = new Set<string>();
/** Aborts the presented request; null while nothing is presented. */
let presented: AbortController | null = null;

/**
 * Wire the live confirm callback. Called once from the confirm host at mount.
 * Pass `null` to unwire on teardown. Swapping the handler denies the request
 * the previous handler was presenting; unwiring also denies every queued one.
 */
export function setPluginConfirmHandler(fn: ConfirmHandler | null): void {
  handler = fn;
  presented?.abort();
  if (!fn) {
    for (const q of queue.splice(0)) {
      pendingPlugins.delete(q.req.pluginId);
      q.resolve("denied");
    }
  }
}

/** Present the next queued request, if nothing is presented. */
function pump(): void {
  if (presented) return;
  const next = queue.shift();
  if (!next) return;
  const live = handler;
  const finish = (outcome: PluginConfirmOutcome) => {
    pendingPlugins.delete(next.req.pluginId);
    next.resolve(outcome);
  };
  if (!live) {
    finish("denied");
    pump();
    return;
  }
  const controller = new AbortController();
  presented = controller;
  let settled = false;
  const settle = (approved: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (presented === controller) presented = null;
    finish(approved && !controller.signal.aborted ? "approved" : "denied");
    pump();
  };
  const timer = setTimeout(() => controller.abort(), PLUGIN_CONFIRM_TIMEOUT_MS);
  controller.signal.addEventListener("abort", () => settle(false));
  live(next.req, controller.signal).then(settle, () => settle(false));
}

/**
 * Ask the operator to approve a plugin action. Resolves `approved` only when a
 * host is wired AND the operator approves within the confirm window; `busy`
 * when this plugin already holds a request; otherwise `denied`.
 */
export function requestPluginConfirm(
  req: PluginConfirmRequest,
): Promise<PluginConfirmOutcome> {
  if (!handler) return Promise.resolve("denied");
  if (pendingPlugins.has(req.pluginId)) return Promise.resolve("busy");
  pendingPlugins.add(req.pluginId);
  const { promise, resolve } = Promise.withResolvers<PluginConfirmOutcome>();
  queue.push({ req, resolve });
  pump();
  return promise;
}

/** Operator-facing error for a confirmation that did not end in approval. */
export function confirmRefusal(
  outcome: Exclude<PluginConfirmOutcome, "approved">,
): string {
  return outcome === "busy"
    ? "a confirmation from this plugin is already pending"
    : "operator denied";
}
