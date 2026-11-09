"use client";

/**
 * @module cockpit/flight/StatusPill
 * @description The top bar's status pill (cockpit spec `layout.json`
 * `status_pill`): "All systems OK", the one active alert's text, or
 * "<n> warnings", coloured by the worst severity. Sources: the cockpit alert
 * rules (link, battery, FC state and status text at WARNING or worse, FC
 * pre-arm, GNSS, EKF, fence, video), pilot readiness, the pilot's ring of FC
 * status text, the navigation source
 * and the companion's storage. A new alert makes the pill flash until it is
 * acknowledged; opening the list acknowledges every alert in it.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useNavSource } from "@/hooks/use-nav-source";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useCockpitAlertList } from "../CockpitAlerts";
import type { CockpitAlertId } from "../band/cockpit-alert-rules";
import type { FcStatusText } from "@/lib/hud/cockpit-frames";

export type PillSeverity = "ok" | "warning" | "critical";

export interface PillAlert {
  key: string;
  severity: Exclude<PillSeverity, "ok">;
  text: string;
  source: string;
}

/** Storage use at which the companion's disk becomes a warning / critical. */
const STORAGE_WARN_PCT = 90;
const STORAGE_CRIT_PCT = 97;

/** The spec source (`status_pill.sources`) each cockpit alert rule speaks for. */
const ALERT_SOURCE: Record<CockpitAlertId, string> = {
  linkLost: "link",
  linkStale: "link",
  videoFrozen: "link",
  battCrit: "battery",
  battLow: "battery",
  prearm: "fc_prearm",
  gpsNo3d: "nav_source",
  ekfFailsafe: "nav_source",
  fcState: "fc_status_text",
  fenceBreach: "fc_status_text",
  statusText: "fc_status_text",
  statusTextWarn: "fc_status_text",
  rcFailsafe: "fc_status_text",
  highVibration: "fc_status_text",
};

export interface PillSummary {
  severity: PillSeverity;
  text: string;
  count: number;
  /** A listed alert has not been acknowledged yet. */
  flashing: boolean;
}

/** The pill's face for a set of alerts and the keys already acknowledged. */
export function pillSummary(alerts: readonly PillAlert[], acked: ReadonlySet<string>): PillSummary {
  const count = alerts.length;
  const severity: PillSeverity =
    count === 0 ? "ok" : alerts.some((a) => a.severity === "critical") ? "critical" : "warning";
  const text =
    count === 0
      ? specString("cockpit.status.ok")
      : count === 1
        ? alerts[0].text
        : specString("cockpit.status.many", { n: count });
  return { severity, text, count, flashing: alerts.some((a) => !acked.has(a.key)) };
}

/** MAVLink severity 0-2 (emergency, alert, critical) is critical; 3-4 a warning. */
const STATUSTEXT_CRITICAL_MAX = 2;

/**
 * The pilot's ring of FC status text (WARNING or worse, last 30 s, newest
 * first) as pill alerts. A line already listed by another source (the FC's
 * own STATUSTEXT over a direct link) is not listed twice.
 */
export function statusTextAlerts(
  ring: readonly FcStatusText[] | undefined,
  listedTexts: ReadonlySet<string>,
): PillAlert[] {
  const out: PillAlert[] = [];
  const seen = new Set<string>();
  for (const s of ring ?? []) {
    if (listedTexts.has(s.text) || seen.has(s.text)) continue;
    seen.add(s.text);
    out.push({
      key: `fc:${s.text}`,
      severity: s.severity <= STATUSTEXT_CRITICAL_MAX ? "critical" : "warning",
      text: s.text,
      source: "fc_status_text",
    });
  }
  return out;
}

function usePillAlerts(droneId: string): PillAlert[] {
  const t = useTranslations("flightScreen.pill");
  const { alerts, label } = useCockpitAlertList(droneId);
  const { pilot } = usePilotState(droneId);
  const nav = useNavSource(droneId).result;
  const navText = t("navSource", { kind: nav.kind });
  const disk = useAgentSystemStore((s) => s.status?.health?.disk_percent ?? null);

  const out: PillAlert[] = alerts.map((a) => ({
    key: `alert:${a.id}:${a.detail ?? ""}`,
    severity: a.level === "critical" ? "critical" : "warning",
    text: label(a),
    source: ALERT_SOURCE[a.id],
  }));
  for (const r of pilot?.readiness ?? []) {
    if (r.ok) continue;
    out.push({
      key: `ready:${r.id}`,
      severity: r.severity === "block" ? "critical" : "warning",
      text: r.msg,
      source: "pilot_readiness",
    });
  }
  out.push(...statusTextAlerts(pilot?.statustext, new Set(out.map((a) => a.text))));
  if (nav.tone === "warn" || nav.tone === "crit") {
    out.push({
      key: `nav:${nav.kind}:${nav.tone}`,
      severity: nav.tone === "crit" ? "critical" : "warning",
      text: navText,
      source: "nav_source",
    });
  }
  if (typeof disk === "number" && disk >= STORAGE_WARN_PCT) {
    out.push({
      key: `storage:${disk >= STORAGE_CRIT_PCT ? "crit" : "warn"}`,
      severity: disk >= STORAGE_CRIT_PCT ? "critical" : "warning",
      text: t("storage", { pct: Math.round(disk) }),
      source: "storage",
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

const ICON = { ok: CircleCheck, warning: TriangleAlert, critical: OctagonAlert } as const;
const COLOR = { ok: "var(--fs-ok)", warning: "var(--fs-warn)", critical: "var(--fs-crit)" } as const;

export function StatusPill({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.pill");
  const alerts = usePillAlerts(droneId);
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => alerts.map((a) => a.key).join("|"), [alerts]);
  // While the list is open every alert in it counts as seen; opening and
  // closing it record them as acknowledged, so one that arrived while it was
  // open does not flash once it closes.
  const summary = pillSummary(alerts, open ? new Set([...acked, ...alerts.map((a) => a.key)]) : acked);
  const ackShown = useCallback((shown: string) => {
    if (shown === "") return;
    setAcked((prev) => {
      const next = new Set(prev);
      for (const k of shown.split("|")) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      ackShown(keys);
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, keys, ackShown]);

  const Icon = ICON[summary.severity];
  return (
    <div ref={rootRef} className="fs-pill-wrap">
      <button
        type="button"
        className="fs-pill"
        data-testid="status-pill"
        data-severity={summary.severity}
        data-flashing={summary.flashing ? "true" : "false"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("aria", { text: summary.text })}
        onClick={() => {
          ackShown(keys);
          setOpen((o) => !o);
        }}
        style={{ "--pill-color": COLOR[summary.severity] } as React.CSSProperties}
      >
        <Icon className="fs-ico" aria-hidden="true" />
        <span className="fs-pill-text">{summary.text}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={specString("cockpit.menu.status")} className="fs-sheet fs-pill-list" data-testid="status-pill-list">
          {alerts.length === 0 ? (
            <p className="fs-sheet-empty">{specString("cockpit.status.ok")}</p>
          ) : (
            <ul>
              {alerts.map((a) => {
                const A = ICON[a.severity];
                return (
                  <li key={a.key} data-severity={a.severity}>
                    <A className="fs-ico" style={{ color: COLOR[a.severity] }} aria-hidden="true" />
                    <span className="fs-pill-item">{a.text}</span>
                    <span className="fs-pill-src">{specString(`cockpit.status.source.${a.source}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
