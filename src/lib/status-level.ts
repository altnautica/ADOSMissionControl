/**
 * @module status-level
 * @description The unified node/health status vocabulary, shared by the status
 * dot, badges and the lib modules that derive a status. Colour is never the
 * only channel a surface uses to show it.
 * @license GPL-3.0-only
 */

export type StatusLevel =
  | "good" // healthy / online / armed-ok
  | "warning" // degraded, needs attention
  | "serious" // stale / reconnecting / unverified (between warning and critical)
  | "critical" // fault / error
  | "idle" // standby / no active work
  | "offline"; // unreachable / unpaired
