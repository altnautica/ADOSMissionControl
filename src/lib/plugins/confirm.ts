/**
 * Module-level operator-confirmation bridge for non-React plugin handler code.
 *
 * Safety-critical plugin RPCs (command.send, mission.write, vision.designate)
 * must not fire without an explicit operator decision. The handlers run outside
 * the React tree — they are plain functions the postMessage bridge dispatches —
 * so they cannot open a React dialog directly. {@link PluginConfirmHost} wires
 * the live confirm callback once at mount via {@link setPluginConfirmHandler};
 * until then {@link requestPluginConfirm} resolves `false` so an un-hosted
 * handler DENIES rather than silently proceeding. Mirrors the
 * `setPluginNotifier` singleton in `src/lib/plugins/notifier.ts`.
 *
 * A pending request is auto-denied after {@link PLUGIN_CONFIRM_TIMEOUT_MS}: the
 * vehicle state the operator is approving against goes stale while a dialog
 * sits open, so an approval long after the prompt is never honoured.
 *
 * @module plugins/confirm
 * @license GPL-3.0-only
 */

/** How long a plugin confirmation stays answerable before it auto-denies. */
export const PLUGIN_CONFIRM_TIMEOUT_MS = 30_000;

export interface PluginConfirmRequest {
  pluginId: string;
  /** Operator-facing name of the drone the action targets. */
  targetName: string;
  title: string;
  body: string;
  /** Drives the dialog variant. `critical` renders the danger styling. */
  severity?: "warning" | "critical";
}

/**
 * The live confirm callback. `signal` aborts when the request times out so
 * the host can drop the dialog; the host resolves `false` on abort.
 */
type ConfirmHandler = (
  req: PluginConfirmRequest,
  signal: AbortSignal,
) => Promise<boolean>;

let handler: ConfirmHandler | null = null;

/**
 * Wire the live confirm callback. Called once from the confirm host at mount.
 * Pass `null` to unwire on teardown.
 */
export function setPluginConfirmHandler(fn: ConfirmHandler | null): void {
  handler = fn;
}

/**
 * Ask the operator to approve a plugin action. Resolves `true` only when a
 * host is wired AND the operator approves within the confirm window. With no
 * host wired, or once the window lapses, this resolves `false`.
 */
export function requestPluginConfirm(
  req: PluginConfirmRequest,
): Promise<boolean> {
  const live = handler;
  if (!live) return Promise.resolve(false);
  const controller = new AbortController();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      controller.abort();
      settle(false);
    }, PLUGIN_CONFIRM_TIMEOUT_MS);
    live(req, controller.signal).then(settle, () => settle(false));
  });
}
