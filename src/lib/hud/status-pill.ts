// The top bar's status pill (cockpit spec `layout.json` `status_pill`): one
// summary of everything that should stop a pilot from flying carelessly, and
// the base alert rules behind it. Sources: the surface's alerts (link,
// battery, GNSS, frozen video, plus whatever the surface adds), the pilot's
// readiness items, the flight controller's PreArm/Arm and status texts,
// on-board storage, and the spec's pilot, link, controller and pre-flight
// rules. It reads "All systems OK", the one active alert's text, or
// "<n> warnings", coloured by the worst severity.
//
// Alert levels:
//   critical: vehicle link lost > 10 s while armed, battery at or below the
//             critical band, a critical battery-engine anomaly, a fresh
//             pilot state reporting the FC's own failsafe RTL or land
//   warning:  vehicle link stale > 3 s, battery at or below the low band, a
//             GPS fix below 3D while armed, frozen video, a battery-engine
//             warning
//   advisory: the ground station's uplink is offline (never in the pill)
// Every rule reads a real field; an unknown reading never alerts.

import layoutJson from "../cockpit-spec/layout.json";
import { BATTERY_CRITICAL_PCT, batteryLowPct, batteryReading, type BatteryHealthInput, type FcBatteryInput } from "./battery";
import type { FcStatusText, PilotState, ReadinessItem } from "./cockpit-frames";
import { CHIP_STALE_AFTER_MS } from "./flight-state";
import { hasSpecText, specText } from "./spec-text";

/** On-board storage use that warns, and that is critical (percent). */
export const STORAGE_WARN_PCT: number = layoutJson.status_pill.storage_warn_pct;
export const STORAGE_CRIT_PCT: number = layoutJson.status_pill.storage_crit_pct;

export const LINK_STALE_MS = 3000;
export const LINK_LOST_MS = 10_000;

export type AlertLevel = "critical" | "warning" | "advisory";

/** One alert. `id` is the spec key suffix (`link_lost`, `batt_low`,
 *  `battery_pack_<pack>_<rule>`, ...), the same on every surface. */
export interface BaseAlert {
  id: string;
  level: AlertLevel;
  title: string;
  detail?: string;
}

export interface BaseAlertInputs {
  /** The telemetry snapshot: arm state, GNSS fix and the FC's battery. */
  telemetry: (FcBatteryInput & { armed?: boolean | null; gps?: { fix_type?: number | null } | null }) | null;
  battery: BatteryHealthInput | null;
  /** Ground station status: the uplink. */
  status: { network?: { uplink_type?: string | null; uplink_reachable?: boolean | null } | null } | null;
  /** Milliseconds since vehicle telemetry was last live; null when it has
   *  never been live this session (nothing to have lost). */
  msSinceLive: number | null;
  /** The video state (`frozen` alerts), or null where no video is mounted. */
  video: string | null;
  /** The arm state at the last live sample (the snapshot drops `armed` once
   *  the link goes quiet). Defaults to the snapshot's own value. */
  armedAtLastLive?: boolean | null;
}

const LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, advisory: 2 };

/** Alerts worst first; equal levels keep their order. */
export function sortAlerts<T extends { level: AlertLevel }>(alerts: T[]): T[] {
  return alerts.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** The alert rules every surface shares, worst first. */
export function baseAlerts(i: BaseAlertInputs): BaseAlert[] {
  const out: BaseAlert[] = [];
  const armed = i.telemetry?.armed === true;

  const armedAtLoss = i.armedAtLastLive ?? armed;
  if (i.msSinceLive != null && i.msSinceLive > LINK_LOST_MS && armedAtLoss) {
    const s = Math.round(i.msSinceLive / 1000);
    out.push({ id: "link_lost", level: "critical", title: specText("alert.link_lost"), detail: specText("alert.link_lost.detail", { s }) });
  } else if (i.msSinceLive != null && i.msSinceLive > LINK_STALE_MS) {
    const s = Math.round(i.msSinceLive / 1000);
    out.push({ id: "link_stale", level: "warning", title: specText("alert.link_stale"), detail: specText("alert.link_stale.detail", { s }) });
  }

  const reading = batteryReading(i.battery, i.telemetry);
  if (reading) {
    const detail = specText("alert.battery.detail", { pct: Math.round(reading.pct) });
    if (reading.pct <= BATTERY_CRITICAL_PCT) {
      out.push({ id: "batt_crit", level: "critical", title: specText("alert.batt_crit"), detail });
    } else if (reading.pct <= batteryLowPct(i.battery)) {
      out.push({ id: "batt_low", level: "warning", title: specText("alert.batt_low"), detail });
    }
  }
  if (i.battery && !i.battery.stale) {
    for (const pack of i.battery.packs) {
      if (pack.stale) continue;
      for (const a of pack.anomalies ?? []) {
        if (a.cleared_at_ms != null) continue;
        if (a.severity !== "critical" && a.severity !== "warning") continue;
        out.push({
          id: `battery_pack_${pack.id}_${a.rule}`,
          level: a.severity,
          title: specText("alert.battery_pack", { pack: pack.id + 1, rule: a.rule.replace(/_/g, " ") }),
        });
      }
    }
  }

  const fix = i.telemetry?.gps?.fix_type;
  if (armed && typeof fix === "number" && fix < 3) {
    out.push({
      id: "gps_no_3d",
      level: "warning",
      title: specText("alert.gps_no_3d"),
      detail: specText(fix <= 1 ? "alert.gps_no_3d.no_fix" : "alert.gps_no_3d.fix_2d"),
    });
  }

  if (i.video === "frozen") {
    out.push({ id: "video_frozen", level: "warning", title: specText("alert.video_frozen") });
  }

  const uplinkType = i.status?.network?.uplink_type;
  if (uplinkType && i.status?.network?.uplink_reachable === false) {
    out.push({ id: "uplink", level: "advisory", title: specText("alert.uplink"), detail: specText("alert.uplink.detail", { type: uplinkType }) });
  }

  return sortAlerts(out);
}

export type PillSource =
  | "pilot_readiness"
  | "fc_prearm"
  | "fc_status_text"
  | "battery"
  | "link"
  | "nav_source"
  | "storage"
  | "video"
  | "pilot"
  | "controller"
  | "preflight";
export type PillSeverity = "ok" | "warning" | "critical";

export interface PillAlert {
  id: string;
  source: PillSource;
  severity: "warning" | "critical";
  text: string;
}

export interface PillInputs {
  alerts: readonly { id: string; level: AlertLevel; title: string }[];
  readiness: readonly ReadinessItem[];
  /** The FC's PreArm/Arm texts from the last 10 s; undefined while unknown. */
  prearm: readonly string[] | undefined;
  storagePct: number | null;
  /** The pilot kind's FC STATUSTEXT at WARNING or worse (last 30 s). */
  fcStatus?: readonly FcStatusText[];
  /** Age of the newest pilot state in ms; null when none ever arrived.
   *  Omitted (undefined) by a surface that does not read the pilot kind:
   *  then the pilot rule is off. With a number at or past
   *  `flight-state.json` `stale_after_ms`, or null, the pill shows one
   *  `pilot_not_answering` warning and drops the readiness, FC status text
   *  and controller items, which came from that stale frame, so it never
   *  reads OK without a fresh pilot state. */
  pilotAgeMs?: number | null;
  /** False while the agent itself does not answer: a critical link item. */
  agentReachable?: boolean;
  /** The pilot holds because the controller was lost, armed and airborne
   *  (see `controllerLost`). */
  controllerLost?: boolean;
  /** The failing pre-flight checklist items. The checklist is a ground
   *  surface: pass them only while on the ground. */
  preflightFailing?: readonly { id: string; label: string }[];
  /** The fresh pilot state reports the FC flying a failsafe RTL or land of
   *  its own (`fc_failsafe`): one critical `failsafe` item. Ignored while
   *  the pilot state is stale. */
  fcFailsafe?: boolean;
  /** Why (`failsafe_cause`: `fc`, `rc_or_failsafe`); null reads as `fc`. */
  failsafeCause?: string | null;
}

/** The pill's failsafe inputs from a pilot state. */
export function pilotFailsafe(p: Pick<PilotState, "fcFailsafe" | "failsafeCause"> | null): { fcFailsafe: boolean; failsafeCause: string | null } {
  return { fcFailsafe: p?.fcFailsafe === true, failsafeCause: p?.failsafeCause ?? null };
}

/** `Failsafe: <cause>`, the cause worded by `pilot.banner.cause.*`; an
 *  unknown cause reads as itself. */
export function failsafeText(cause: string | null | undefined): string {
  const c = cause || "fc";
  const key = `pilot.banner.cause.${c}`;
  return specText("alert.failsafe", { cause: hasSpecText(key) ? specText(key) : c });
}

/** The pilot holds for a lost controller while armed and airborne (spec
 *  `status_pill.controller_rule`). */
export function controllerLost(p: Pick<PilotState, "holdReason" | "armed" | "landed"> | null): boolean {
  return p !== null && p.holdReason === "controller-lost" && p.armed && !p.landed;
}

/** The pill source of an alert id. */
export function alertSource(id: string): PillSource {
  if (id === "batt_crit" || id === "batt_low" || id.startsWith("battery_pack_")) return "battery";
  if (id === "gps_no_3d") return "nav_source";
  if (id === "video_frozen") return "video";
  return "link";
}

/** Every active pill alert, worst first, then in source order. Advisories
 *  (an offline uplink) are not warnings and stay out of the pill. */
export function pillAlerts(i: PillInputs): PillAlert[] {
  const out: PillAlert[] = [];
  for (const a of i.alerts) {
    if (a.level === "advisory") continue;
    out.push({ id: `alert:${a.id}`, source: alertSource(a.id), severity: a.level, text: a.title });
  }
  if (i.agentReachable === false) {
    out.push({ id: "agent_unreachable", source: "link", severity: "critical", text: specText("alert.agent_unreachable") });
  }
  const pilotStale = i.pilotAgeMs === null || (i.pilotAgeMs !== undefined && i.pilotAgeMs >= CHIP_STALE_AFTER_MS);
  if (pilotStale) {
    out.push({ id: "pilot_not_answering", source: "pilot", severity: "warning", text: specText("alert.pilot_not_answering") });
  } else if (i.fcFailsafe) {
    out.push({ id: "failsafe", source: "pilot", severity: "critical", text: failsafeText(i.failsafeCause) });
  }
  for (const r of pilotStale ? [] : i.readiness) {
    if (r.ok) continue;
    // A blocking item refuses take-off: critical, as the pre-flight sheet fails it.
    out.push({ id: `pilot:${r.id}`, source: "pilot_readiness", severity: r.severity === "block" ? "critical" : "warning", text: r.msg || r.id });
  }
  if (i.controllerLost && !pilotStale) {
    out.push({ id: "controller_lost", source: "controller", severity: "warning", text: specText("alert.controller_lost") });
  }
  for (const item of i.preflightFailing ?? []) {
    out.push({ id: `preflight:${item.id}`, source: "preflight", severity: "warning", text: specText("alert.preflight_failing", { item: item.label }) });
  }
  if (i.prearm && i.prearm.length > 0) {
    const text = i.prearm[i.prearm.length - 1].replace(/^(PreArm|Arm):\s*/, "");
    out.push({ id: `fc:${text}`, source: "fc_prearm", severity: "warning", text: specText("flow.preflight.fc_prearm.failing", { text }) });
  }
  // The FC repeats a warning while its condition lasts: one alert per text,
  // at the worst severity it was sent with.
  const fcAt = new Map<string, number>();
  for (const s of pilotStale ? [] : (i.fcStatus ?? [])) {
    // PreArm/Arm lines already reach the pill through `prearm`.
    if (/^(PreArm|Arm):/.test(s.text)) continue;
    const severity = s.severity <= 2 ? "critical" : "warning";
    const at = fcAt.get(s.text);
    if (at === undefined) {
      fcAt.set(s.text, out.length);
      out.push({ id: `fcst:${s.text}`, source: "fc_status_text", severity, text: s.text });
    } else if (severity === "critical") {
      out[at].severity = "critical";
    }
  }
  if (i.storagePct !== null && i.storagePct >= STORAGE_WARN_PCT) {
    out.push({
      id: "storage",
      source: "storage",
      severity: i.storagePct >= STORAGE_CRIT_PCT ? "critical" : "warning",
      text: specText("cockpit.status.storage_used", { pct: Math.round(i.storagePct) }),
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

export interface PillSummary {
  severity: PillSeverity;
  text: string;
  count: number;
  /** An alert not yet acknowledged is active. */
  flashing: boolean;
  alerts: readonly PillAlert[];
}

/** The pill's face for the active alerts and the acknowledged ids. */
export function pillSummary(alerts: readonly PillAlert[], acked: ReadonlySet<string>): PillSummary {
  const count = alerts.length;
  const severity: PillSeverity = count === 0 ? "ok" : alerts.some((a) => a.severity === "critical") ? "critical" : "warning";
  const text =
    count === 0
      ? specText("cockpit.status.ok")
      : count === 1
        ? alerts[0].text || specText("cockpit.status.one")
        : specText("cockpit.status.many", { n: count });
  return { severity, text, count, flashing: alerts.some((a) => !acked.has(a.id)), alerts };
}
