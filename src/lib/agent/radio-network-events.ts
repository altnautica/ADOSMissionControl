/**
 * @module agent/radio-network-events
 * @description Pure mapping from the durable-store radio/network event
 * rows to a human-readable activity item the Radio / Network Health panel
 * renders. Keeps the summary + severity logic out of the store and the
 * component so it can be unit-tested in isolation.
 *
 * The agent emits these discrete event kinds (kind=events) for the radio
 * and onboard-network self-heal surfaces:
 *
 *   radio.reg_reasserted     the global regulatory domain was re-pinned off
 *                            the adapter EEPROM country
 *   radio.reg_gate           a reg-gate verdict (allowed / blocked)
 *   radio.bind               a bind cycle succeeded
 *   radio.bind_failed        a bind cycle failed, with a reason enum
 *   radio.rf_unverified      TX advancing while reception is absent
 *                            (state=entry), or that state clearing
 *                            (state=clear)
 *   network.wifi_reassociated the onboard-WiFi self-heal re-associated the
 *                            management interface
 *
 * @license GPL-3.0-only
 */

import type { EventsRow } from "./agent-client/logging";

/** Severity buckets, mapped 1:1 onto the dark-theme status colors. */
export type RadioEventSeverity = "success" | "warning" | "error";

/** The event kinds this surface queries + renders. The store passes this
 * exact list to `client.logging.query({ event_kind })`. */
export const RADIO_NETWORK_EVENT_KINDS = [
  "radio.reg_reasserted",
  "radio.reg_gate",
  "radio.bind",
  "radio.bind_failed",
  "radio.rf_unverified",
  "network.wifi_reassociated",
] as const;

export type RadioNetworkEventKind = (typeof RADIO_NETWORK_EVENT_KINDS)[number];

/** One rendered activity row. */
export interface RadioNetworkActivity {
  /** React key + dedupe key. */
  id: string;
  /** The originating event kind. */
  kind: string;
  /** ISO-8601 timestamp the agent stamped on the event. */
  ts: string;
  /** Microsecond sort key (newest first). */
  tsUs: number;
  /** Human-readable one-line summary. */
  summary: string;
  severity: RadioEventSeverity;
}

/** bind_failed reason enum → readable text. Unknown reasons fall through
 * to a generic line rather than leaking the raw token. */
const BIND_FAIL_REASON: Record<string, string> = {
  no_tx_key: "no transmit key",
  reg_blocked: "regulatory domain blocked",
  no_peer: "peer not found",
  // The bind wire protocol ran to completion but no decoded peer frames ever
  // crossed the bind link — a phantom pairing, not a real one.
  no_peer_proof: "no verified peer (phantom pairing)",
  // The upstream key was never refreshed this session, so nothing was actually
  // transferred to the far side.
  stale_key: "stale key, none transferred",
  timeout: "bind timeout",
  interrupted: "bind interrupted",
  other: "unknown error",
};

function bindFailReasonLabel(reason: unknown): string {
  if (typeof reason === "string" && reason in BIND_FAIL_REASON) {
    return BIND_FAIL_REASON[reason];
  }
  return "unknown error";
}

function str(data: Record<string, unknown> | undefined, key: string): string | null {
  const v = data?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(data: Record<string, unknown> | undefined, key: string): number | null {
  const v = data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Build the human-readable summary + severity for one event kind. The
 * `data` block is whatever the agent attached; every read is defensive so
 * a sparse or forward-versioned payload still renders a sensible line. */
export function summarizeRadioNetworkEvent(
  kind: string,
  data: Record<string, unknown> | undefined,
): { summary: string; severity: RadioEventSeverity } {
  switch (kind) {
    case "radio.reg_reasserted": {
      const from = str(data, "from_country");
      const to = str(data, "to_country");
      const permitted = data?.["channel_permitted"];
      if (from && to) {
        return {
          summary: `Regulatory domain re-pinned ${from} to ${to}`,
          severity: permitted === false ? "warning" : "success",
        };
      }
      if (to) {
        return {
          summary: `Regulatory domain re-pinned to ${to}`,
          severity: "success",
        };
      }
      return { summary: "Regulatory domain re-pinned", severity: "success" };
    }

    case "radio.reg_gate": {
      const result = str(data, "result");
      const reason = str(data, "reason");
      if (result === "blocked" || result === "deny" || result === "denied") {
        return {
          summary: reason
            ? `Reg-gate blocked: ${reason}`
            : "Reg-gate blocked the requested channel",
          severity: "warning",
        };
      }
      if (result) {
        return { summary: `Reg-gate ${result}`, severity: "success" };
      }
      return { summary: "Reg-gate verdict", severity: "success" };
    }

    case "radio.bind":
      return { summary: "Bind succeeded", severity: "success" };

    case "radio.bind_failed":
      return {
        summary: `Bind failed: ${bindFailReasonLabel(data?.["reason"])}`,
        severity: "error",
      };

    case "radio.rf_unverified": {
      const state = str(data, "state");
      if (state === "clear" || state === "cleared" || state === "exit") {
        return { summary: "Link verified: reception confirmed", severity: "success" };
      }
      // state=entry (or absent): TX advancing with no received-side signal.
      const speed = num(data, "usb_speed_mbps");
      const speedNote = speed != null ? ` (USB ${speed} Mbps)` : "";
      return {
        summary: `Link unverified: TX active, no reception${speedNote}`,
        severity: "error",
      };
    }

    case "network.wifi_reassociated": {
      const failures = num(data, "consecutive_failures");
      if (failures != null && failures > 0) {
        return {
          summary: `Onboard WiFi re-associated (gateway unreachable x${failures})`,
          severity: "warning",
        };
      }
      return { summary: "Onboard WiFi re-associated", severity: "warning" };
    }

    default:
      return { summary: kind, severity: "warning" };
  }
}

/** Coerce one durable-store `EventsRow` into a rendered activity item. */
export function toRadioNetworkActivity(
  row: EventsRow,
  idx: number,
): RadioNetworkActivity {
  const { summary, severity } = summarizeRadioNetworkEvent(row.kind, row.data);
  // The store sorts on tsUs; a stable id keeps React keys steady within a
  // page even when two events share a microsecond stamp.
  const id = `${row.kind}-${row.ts_us}-${idx}`;
  return {
    id,
    kind: row.kind,
    ts: row.ts,
    tsUs: typeof row.ts_us === "number" && Number.isFinite(row.ts_us) ? row.ts_us : 0,
    summary,
    severity,
  };
}

/** Map a raw event envelope's rows to sorted activity items (newest
 * first), capped at `max`. */
export function mapRadioNetworkEvents(
  rows: EventsRow[],
  max: number,
): RadioNetworkActivity[] {
  const items = rows.map((row, i) => toRadioNetworkActivity(row, i));
  items.sort((a, b) => b.tsUs - a.tsUs);
  return items.slice(0, max);
}
