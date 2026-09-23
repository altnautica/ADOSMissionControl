/**
 * Module-level toast bridge for non-React plugin handler code.
 *
 * Plugin RPC handlers run outside the React tree — they are plain
 * functions the postMessage bridge dispatches — so they cannot call a
 * React toast hook directly. The plugin host wires the live toast
 * callback once at mount via {@link setPluginNotifier}; until then
 * notifications are dropped so a handler never throws for want of a UI.
 *
 * Every notification carries the id of the plugin it concerns, so the host
 * renders it attributed and a plugin can never pass for a host alert. Each
 * plugin gets a small burst budget that refills over a window; past it the
 * notification is dropped, so a looping plugin cannot bury host toasts.
 *
 * @module plugins/notifier
 * @license GPL-3.0-only
 */

export type PluginNotifyStatus = "success" | "warning" | "error" | "info";

type Notifier = (pluginId: string, message: string, status: PluginNotifyStatus) => void;

/** Notifications one plugin may raise within {@link PLUGIN_NOTIFY_WINDOW_MS}. */
export const PLUGIN_NOTIFY_BURST = 5;
/** Sliding window the per-plugin burst budget is counted over. */
export const PLUGIN_NOTIFY_WINDOW_MS = 10_000;

let notifier: Notifier | null = null;
/** Recent notification times per plugin, oldest first. */
const recent = new Map<string, number[]>();

/**
 * Wire the live toast callback. Called once from the plugin host at mount.
 * Pass `null` to unwire on teardown.
 */
export function setPluginNotifier(fn: Notifier | null): void {
  notifier = fn;
  recent.clear();
}

/**
 * Raise a toast attributed to `pluginId` from non-React handler code. No-op
 * until a notifier is wired, so a handler can call this unconditionally.
 * Returns false when the plugin is over its burst budget and the
 * notification was dropped.
 */
export function pluginNotify(
  pluginId: string,
  message: string,
  status: PluginNotifyStatus,
): boolean {
  const now = Date.now();
  const times = (recent.get(pluginId) ?? []).filter(
    (t) => now - t < PLUGIN_NOTIFY_WINDOW_MS,
  );
  if (times.length >= PLUGIN_NOTIFY_BURST) {
    recent.set(pluginId, times);
    return false;
  }
  times.push(now);
  recent.set(pluginId, times);
  notifier?.(pluginId, message, status);
  return true;
}
