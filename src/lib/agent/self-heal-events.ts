/**
 * @module agent/self-heal-events
 * @description Pure mapping from the durable-store self-heal event rows to
 * human-readable activity items for the node Settings "Self-heal" page. The
 * agent's always-on protections each emit discrete events (kind=events) into
 * the on-device log store:
 *
 *   network.wifi_reassociated      the onboard-WiFi self-heal re-associated
 *                                  the management interface
 *   network.link_health_check      a management-link health-state transition
 *                                  (healthy / degraded / down)
 *   network.link_repair_attempt    the link guardian ran one repair rung
 *   network.link_repair_exhausted  every repair rung tried, link still dead
 *   camera.usb_recovery            a camera USB-recovery episode step
 *   camera.power_contention        USB power contention affecting the camera
 *   radio.reg_reasserted           the regulatory-domain reconciler re-pinned
 *                                  the global domain
 *
 * The two kinds shared with the Radio / Network Health surface delegate to
 * its summarizer so one wording exists per event. Every read of the event's
 * `data` block is defensive: a sparse or forward-versioned payload still
 * renders a sensible line, never a fabricated detail.
 * @license GPL-3.0-only
 */

import type { EventsRow } from "./agent-client/logging";
import {
  summarizeRadioNetworkEvent,
  type RadioEventSeverity,
} from "./radio-network-events";

/** The event kinds the self-heal page queries + renders. Passed verbatim to
 * `client.logging.query({ event_kind })`. */
export const SELF_HEAL_EVENT_KINDS = [
  "network.wifi_reassociated",
  "network.link_health_check",
  "network.link_repair_attempt",
  "network.link_repair_exhausted",
  "camera.usb_recovery",
  "camera.power_contention",
  "radio.reg_reasserted",
] as const;

export type SelfHealEventKind = (typeof SELF_HEAL_EVENT_KINDS)[number];

/** One rendered activity row (same shape family as the radio feed). */
export interface SelfHealActivity {
  /** React key + dedupe key. */
  id: string;
  kind: string;
  /** ISO-8601 timestamp the agent stamped on the event. */
  ts: string;
  /** Microsecond sort key (newest first). */
  tsUs: number;
  summary: string;
  severity: RadioEventSeverity;
}

/** Guardian repair rung → readable phrase. Unknown rungs fall through to a
 * generic phrase rather than leaking the raw token. Shared with the Settings
 * page's live guardian row, so the ladder is worded once. */
const REPAIR_RUNG_PHRASE: Record<string, string> = {
  reassert_reg: "re-asserting regulatory domain",
  renew_dhcp: "renewing DHCP",
  reconnect_wifi: "reconnecting Wi-Fi",
  bounce_iface: "bouncing interface",
  restart_backend: "restarting network service",
  exhausted: "software repair exhausted, hardware-level recovery may be needed",
};

/** Readable phrase for a guardian repair rung, or null for an unknown one. */
export function repairRungPhrase(rung: string): string | null {
  return REPAIR_RUNG_PHRASE[rung] ?? null;
}

function str(
  data: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const v = data?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(
  data: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const v = data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Append " (iface)" when the event names the interface. */
function withIface(
  base: string,
  data: Record<string, unknown> | undefined,
): string {
  const iface = str(data, "interface");
  return iface ? `${base} (${iface})` : base;
}

/** Camera-recovery step verb per reported state. Unknown states fall through
 * to the raw token (it is the agent's own word for the step). */
const CAMERA_STEP_VERB: Record<string, string> = {
  rebinding: "re-binding the device",
  port_cycling: "power-cycling the port",
  hub_resetting: "resetting the hub",
};

/** Build the human-readable summary + severity for one event kind. */
export function summarizeSelfHealEvent(
  kind: string,
  data: Record<string, unknown> | undefined,
): { summary: string; severity: RadioEventSeverity } {
  switch (kind) {
    // Shared with the Radio / Network Health feed — one wording each.
    case "network.wifi_reassociated":
    case "radio.reg_reasserted":
      return summarizeRadioNetworkEvent(kind, data);

    case "network.link_health_check": {
      const state = str(data, "state");
      if (state === "healthy") {
        return {
          summary: withIface("Management link healthy", data),
          severity: "success",
        };
      }
      if (state === "degraded") {
        return {
          summary: withIface("Management link degraded, no data path", data),
          severity: "warning",
        };
      }
      if (state === "down") {
        return {
          summary: withIface("Management link down", data),
          severity: "error",
        };
      }
      return {
        summary: withIface("Management link state changed", data),
        severity: "warning",
      };
    }

    case "network.link_repair_attempt": {
      const rung = str(data, "rung");
      const phrase =
        (rung ? REPAIR_RUNG_PHRASE[rung] : null) ?? "running a repair step";
      return {
        summary: withIface(`Management-link repair: ${phrase}`, data),
        severity: "warning",
      };
    }

    case "network.link_repair_exhausted":
      return {
        summary: withIface(
          "Management-link repair exhausted, hardware-level recovery may be needed",
          data,
        ),
        severity: "error",
      };

    case "camera.usb_recovery": {
      const state = str(data, "state");
      const attempt = num(data, "attempt");
      const maxAttempts = num(data, "max_attempts");
      const attemptNote =
        attempt != null && attempt > 0 && maxAttempts != null
          ? ` (attempt ${attempt} of ${maxAttempts})`
          : "";
      if (state === "success") {
        return { summary: "Camera USB recovery succeeded", severity: "success" };
      }
      if (state === "exhausted") {
        return {
          summary: `Camera USB recovery exhausted${attemptNote}`,
          severity: "error",
        };
      }
      if (state === "needs_hub_reset") {
        return {
          summary: "Camera needs a physical reseat or hub power-cycle",
          severity: "warning",
        };
      }
      if (state === "guard_blocked") {
        return {
          summary:
            "Camera recovery held back (a reset could disturb a shared hub)",
          severity: "warning",
        };
      }
      const verb = (state ? CAMERA_STEP_VERB[state] : null) ?? state;
      if (verb) {
        return {
          summary: `Camera USB recovery: ${verb}${attemptNote}`,
          severity: "warning",
        };
      }
      return { summary: "Camera USB recovery step", severity: "warning" };
    }

    case "camera.power_contention":
      return {
        summary: "Camera USB power contention detected",
        severity: "warning",
      };

    default:
      return { summary: kind, severity: "warning" };
  }
}

/** Coerce one durable-store `EventsRow` into a rendered activity item. */
export function toSelfHealActivity(
  row: EventsRow,
  idx: number,
): SelfHealActivity {
  const { summary, severity } = summarizeSelfHealEvent(row.kind, row.data);
  const id = `${row.kind}-${row.ts_us}-${idx}`;
  return {
    id,
    kind: row.kind,
    ts: row.ts,
    tsUs:
      typeof row.ts_us === "number" && Number.isFinite(row.ts_us)
        ? row.ts_us
        : 0,
    summary,
    severity,
  };
}

/** Map a raw event envelope's rows to sorted activity items (newest first),
 * capped at `max`. */
export function mapSelfHealEvents(
  rows: EventsRow[],
  max: number,
): SelfHealActivity[] {
  const items = rows.map((row, i) => toSelfHealActivity(row, i));
  items.sort((a, b) => b.tsUs - a.tsUs);
  return items.slice(0, max);
}
