/**
 * Service-state vocabulary translation.
 *
 * The agent reports systemd's own vocabulary: an `ActiveState` string
 * ("active" | "inactive" | "failed" | "activating" | "deactivating" |
 * "reloading"), a `sub_state` ("running" | "dead" | "exited" | ...), and an
 * `active` boolean it has already computed as `ActiveState == "active"`.
 *
 * The GCS renders a different, UI-facing vocabulary (`ServiceInfo["status"]`)
 * which has no "active" member. Passing the agent's string straight through
 * therefore produced a value outside the union: every "is it up?" check
 * compared against "running" and matched nothing, so a fully healthy box
 * reported "0/N running" above rows that each read "active".
 *
 * This module is the ONLY place that knows both vocabularies. Every consumer
 * (LAN poll, LAN full-status mapper, cloud heartbeat mapper) routes through it
 * so the two link types can never drift apart again.
 */

/** The UI-facing vocabulary. Kept here so it lives beside the translation. */
export const SERVICE_STATUSES = [
  "running",
  "stopped",
  "error",
  "degraded",
  "starting",
  "circuit_open",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

function isServiceStatus(value: unknown): value is ServiceStatus {
  return (
    typeof value === "string" &&
    (SERVICE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The raw per-service shape as it arrives from either link. Fields are optional
 * because the LAN and cloud payloads carry overlapping but non-identical sets.
 */
export interface RawServiceState {
  /** Already-normalised status, when a producer has one. */
  status?: unknown;
  /** systemd ActiveState, e.g. "active" | "failed" | "activating". */
  state?: unknown;
  /** systemd SubState, e.g. "running" | "exited" | "dead". */
  sub_state?: unknown;
  subState?: unknown;
  /** The agent's own computed truth: ActiveState == "active". */
  active?: unknown;
}

/**
 * Translate one service record into the UI vocabulary.
 *
 * Precedence is deliberate:
 *  1. An already-valid UI status wins (a producer that did its own mapping).
 *  2. systemd `ActiveState`, which carries the real distinctions we care about
 *     (failed vs starting vs stopped).
 *  3. The agent's `active` boolean as a last resort.
 *
 * Anything genuinely unrecognised becomes "degraded", never "stopped". An
 * unknown state is not evidence a service is down, and claiming it is would be
 * a fabricated negative.
 */
export function normalizeServiceStatus(raw: RawServiceState): ServiceStatus {
  if (isServiceStatus(raw.status)) return raw.status;

  const activeState = typeof raw.state === "string" ? raw.state : undefined;
  const subState =
    typeof raw.sub_state === "string"
      ? raw.sub_state
      : typeof raw.subState === "string"
        ? raw.subState
        : undefined;

  if (activeState) {
    switch (activeState) {
      case "active":
        // A oneshot unit that ran to completion reports active/exited. It did
        // its job, so it is healthy, not stopped.
        return "running";
      case "activating":
      case "reloading":
        return "starting";
      case "failed":
        return "error";
      case "deactivating":
      case "inactive":
        return "stopped";
      default:
        // An ActiveState we do not know. Say so rather than inventing "down".
        return "degraded";
    }
  }

  // No ActiveState at all. Fall back to the agent's boolean if it sent one.
  if (typeof raw.active === "boolean") {
    return raw.active ? "running" : "stopped";
  }

  // Some producers only send a sub_state.
  if (subState === "running") return "running";
  if (subState === "dead") return "stopped";

  return "degraded";
}

/** True when a service is up. The one predicate every count should use. */
export function isServiceUp(status: string): boolean {
  return status === "running";
}

/**
 * Count of running services in a list, for header readouts.
 *
 * Takes a loose `{ status: string }` because the cloud-status row carries the
 * field widened to `string`. Every producer normalises before storing, so a
 * plain equality check here is correct; accepting the loose shape just avoids
 * forcing a cast at each call site.
 */
export function countRunning(services: readonly { status: string }[]): number {
  return services.reduce((n, s) => (isServiceUp(s.status) ? n + 1 : n), 0);
}
