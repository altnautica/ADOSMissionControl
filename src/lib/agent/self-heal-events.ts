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
 * Wording is localized: the caller passes a translator scoped to the
 * `nodeSettings.selfHeal` namespace and this module composes each summary from
 * i18n keys (never a hardcoded English string). Every read of the event's
 * `data` block is defensive: a sparse or forward-versioned payload still
 * renders a sensible line, never a fabricated detail — an unknown camera step
 * or reg-domain code renders the agent's own token raw rather than a guess.
 * @license GPL-3.0-only
 */

import type { EventsRow } from "./agent-client/logging";
import type { RadioEventSeverity } from "./radio-network-events";

/** A translator scoped to the `nodeSettings.selfHeal` namespace. Kept loose
 * (dynamic string keys + simple interpolation values) so the pure formatter can
 * compose keys the caller resolves; `useTranslations("nodeSettings.selfHeal")`
 * satisfies it. */
export type SelfHealTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

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
  /** Localized one-line summary. */
  summary: string;
  severity: RadioEventSeverity;
}

/** Guardian repair rung → i18n key (relative to `nodeSettings.selfHeal`).
 * Unknown rungs fall through to a generic phrase rather than leaking the raw
 * token. Shared with the Settings page's live guardian row, so the ladder is
 * worded once. */
const REPAIR_RUNG_KEY: Record<string, string> = {
  reassert_reg: "rungs.reassertReg",
  renew_dhcp: "rungs.renewDhcp",
  reconnect_wifi: "rungs.reconnectWifi",
  bounce_iface: "rungs.bounceIface",
  restart_backend: "rungs.restartBackend",
  exhausted: "rungs.exhausted",
};

/** Localized phrase for a guardian repair rung, or null for an unknown one. */
export function repairRungPhrase(
  t: SelfHealTranslator,
  rung: string,
): string | null {
  const key = REPAIR_RUNG_KEY[rung];
  return key ? t(key) : null;
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

/** Append " (iface)" when the event names the interface, localized. */
function withIface(
  t: SelfHealTranslator,
  base: string,
  data: Record<string, unknown> | undefined,
): string {
  const iface = str(data, "interface");
  return iface ? t("events.withIface", { base, iface }) : base;
}

/** Camera-recovery step verb per reported state → i18n key. Unknown states
 * fall through to the raw token (it is the agent's own word for the step). */
const CAMERA_STEP_KEY: Record<string, string> = {
  rebinding: "cameraSteps.rebinding",
  port_cycling: "cameraSteps.portCycling",
  hub_resetting: "cameraSteps.hubResetting",
};

/** Build the localized summary + severity for one event kind. */
export function summarizeSelfHealEvent(
  t: SelfHealTranslator,
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
          summary: t("events.regRepinnedFromTo", { from, to }),
          severity: permitted === false ? "warning" : "success",
        };
      }
      if (to) {
        return { summary: t("events.regRepinnedTo", { to }), severity: "success" };
      }
      return { summary: t("events.regRepinned"), severity: "success" };
    }

    case "network.wifi_reassociated": {
      const failures = num(data, "consecutive_failures");
      if (failures != null && failures > 0) {
        return {
          summary: t("events.wifiReassociatedFailures", { failures }),
          severity: "warning",
        };
      }
      return { summary: t("events.wifiReassociated"), severity: "warning" };
    }

    case "network.link_health_check": {
      const state = str(data, "state");
      if (state === "healthy") {
        return {
          summary: withIface(t, t("events.linkHealthy"), data),
          severity: "success",
        };
      }
      if (state === "degraded") {
        return {
          summary: withIface(t, t("events.linkDegraded"), data),
          severity: "warning",
        };
      }
      if (state === "down") {
        return {
          summary: withIface(t, t("events.linkDown"), data),
          severity: "error",
        };
      }
      return {
        summary: withIface(t, t("events.linkStateChanged"), data),
        severity: "warning",
      };
    }

    case "network.link_repair_attempt": {
      const rung = str(data, "rung");
      const rungKey = rung ? REPAIR_RUNG_KEY[rung] : undefined;
      const phrase = rungKey ? t(rungKey) : t("rungs.generic");
      return {
        summary: withIface(t, t("events.linkRepair", { phrase }), data),
        severity: "warning",
      };
    }

    case "network.link_repair_exhausted":
      return {
        summary: withIface(t, t("events.linkRepairExhausted"), data),
        severity: "error",
      };

    case "camera.usb_recovery": {
      const state = str(data, "state");
      const attempt = num(data, "attempt");
      const maxAttempts = num(data, "max_attempts");
      const hasAttempt = attempt != null && attempt > 0 && maxAttempts != null;
      if (state === "success") {
        return {
          summary: t("events.cameraRecoverySucceeded"),
          severity: "success",
        };
      }
      if (state === "exhausted") {
        return {
          summary: hasAttempt
            ? t("events.cameraRecoveryExhaustedAttempt", { attempt, maxAttempts })
            : t("events.cameraRecoveryExhausted"),
          severity: "error",
        };
      }
      if (state === "needs_hub_reset") {
        return { summary: t("events.cameraNeedsReseat"), severity: "warning" };
      }
      if (state === "guard_blocked") {
        return { summary: t("events.cameraHeldBack"), severity: "warning" };
      }
      const stepKey = state ? CAMERA_STEP_KEY[state] : undefined;
      const verb = stepKey ? t(stepKey) : state;
      if (verb) {
        return {
          summary: hasAttempt
            ? t("events.cameraStepAttempt", { verb, attempt, maxAttempts })
            : t("events.cameraStep", { verb }),
          severity: "warning",
        };
      }
      return { summary: t("events.cameraStepGeneric"), severity: "warning" };
    }

    case "camera.power_contention":
      return {
        summary: t("events.cameraPowerContention"),
        severity: "warning",
      };

    default:
      // Forward-versioned kind: surface the agent's own token, never a guess.
      return { summary: kind, severity: "warning" };
  }
}

/** Coerce one durable-store `EventsRow` into a rendered activity item. */
export function toSelfHealActivity(
  t: SelfHealTranslator,
  row: EventsRow,
  idx: number,
): SelfHealActivity {
  const { summary, severity } = summarizeSelfHealEvent(t, row.kind, row.data);
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
  t: SelfHealTranslator,
  rows: EventsRow[],
  max: number,
): SelfHealActivity[] {
  const items = rows.map((row, i) => toSelfHealActivity(t, row, i));
  items.sort((a, b) => b.tsUs - a.tsUs);
  return items.slice(0, max);
}
