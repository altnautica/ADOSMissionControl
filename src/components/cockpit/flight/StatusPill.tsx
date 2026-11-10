"use client";

/**
 * @module cockpit/flight/StatusPill
 * @description The top bar's status pill (cockpit spec `layout.json`
 * `status_pill`): "All systems OK", the one active alert's text, or
 * "<n> warnings", coloured by the worst severity. The rules are the shared
 * ones (`@/lib/hud/status-pill`): pilot readiness and its FC status text
 * while the pilot state is fresh, one "Pilot not answering" warning when it
 * is absent or stale, the agent's reachability, a controller lost in the
 * air, failing pre-flight checks on the ground, FC pre-arm and storage. This
 * surface adds its own cockpit alert rules (link, battery, FC state and
 * status text, fence, video) and the navigation source. A new alert makes
 * the pill flash until it is acknowledged; opening the list acknowledges
 * every alert in it.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import type { PreflightItem } from "@/lib/cockpit/preflight";
import { useNavSource } from "@/hooks/use-nav-source";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { resolveNodeId, useNodeRegistryStore } from "@/stores/node-registry";
import { useChecklistStore } from "@/stores/checklist-store";
import { useCockpitAlertList } from "../CockpitAlerts";
import type { CockpitAlertId } from "../band/cockpit-alert-rules";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import {
  controllerLost,
  pillAlerts,
  pilotFailsafe,
  pillSummary,
  type PillAlert,
  type PillSource,
} from "@/lib/hud/status-pill";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { useDroneStore } from "@/stores/drone-store";
import { useFlightSheet } from "./flight-sheet";

export type { PillAlert } from "@/lib/hud/status-pill";

/** The spec source (`status_pill.sources`) each cockpit alert rule speaks for. */
const ALERT_SOURCE: Record<CockpitAlertId, PillSource> = {
  linkLost: "link",
  linkStale: "link",
  videoFrozen: "video",
  battCrit: "battery",
  battLow: "battery",
  prearm: "fc_prearm",
  gpsNo3d: "nav_source",
  ekfFailsafe: "nav_source",
  fcState: "fc_status_text",
  fenceBreach: "fc_status_text",
  statusText: "fc_status_text",
  statusTextWarn: "fc_status_text",
  rcFailsafe: "link",
  highVibration: "fc_status_text",
};

/** The pill source a pre-flight item already reaches the pill through. */
const PREFLIGHT_SOURCE: Readonly<Record<string, PillSource>> = {
  fc_prearm: "fc_prearm",
  storage: "storage",
  link: "link",
  battery: "battery",
  nav_source: "nav_source",
  controller: "controller",
};

/** Spec key naming each pill source in the list. The video source reuses
 *  the camera's "Video" word; every other source has its own key. */
export function pillSourceLabel(source: PillSource): string {
  return specString(source === "video" ? "cockpit.camera.video" : `cockpit.status.source.${source}`);
}

const PREARM = /^(PreArm|Arm):/;

/** Agent polls failing this many times in a row (about 9 s) read as an
 *  unreachable agent, the point where its data is marked stale. */
const AGENT_UNREACHABLE_FAILURES = 3;

export interface PillSources {
  /** This surface's cockpit alert rules and navigation source, labelled. */
  surface: readonly PillAlert[];
  pilot: PilotState | null;
  /** Age of the newest pilot state; null when none arrived from this
   *  drone's agent; undefined when this drone has no agent (the pilot rule
   *  is off). */
  pilotAgeMs: number | null | undefined;
  /** Undefined unless the focused agent is this drone's. */
  agentReachable: boolean | undefined;
  disarmed: boolean;
  /** The pre-flight checklist, or null before it was evaluated. */
  preflight: readonly PreflightItem[] | null;
  storagePct: number | null;
}

/**
 * Every pill alert, worst first. The shared rules run on the pilot's fields;
 * a pilot FC status line this surface already lists (the FC's own STATUSTEXT
 * over a direct link) is not listed twice, and the pilot's PreArm lines are
 * the FC pre-arm item on the ground unless the surface's own pre-arm rule
 * already lists one. A failing pre-flight check is listed only when no other
 * item of its source is, so the pill never reads OK while a check fails.
 */
export function pillAlertsFor(s: PillSources): PillAlert[] {
  const fresh = typeof s.pilotAgeMs === "number" && pilotFresh(0, s.pilotAgeMs);
  const ring = fresh ? (s.pilot?.statustext ?? []) : [];
  const surfacePrearm = s.surface.some((a) => a.source === "fc_prearm");
  // The ring is newest first; the shared rule reads the newest last.
  const prearm =
    s.disarmed && !surfacePrearm ? ring.filter((r) => PREARM.test(r.text)).map((r) => r.text).reverse() : [];
  const surfaceTexts = new Set(s.surface.map((a) => a.text));
  const shared = pillAlerts({
    alerts: [],
    readiness: s.pilot?.readiness ?? [],
    prearm: prearm.length > 0 ? prearm : undefined,
    storagePct: s.storagePct,
    fcStatus: ring,
    pilotAgeMs: s.pilotAgeMs,
    agentReachable: s.agentReachable,
    controllerLost: fresh && controllerLost(s.pilot),
    ...pilotFailsafe(s.pilot),
  }).filter((a) => !(a.source === "fc_status_text" && surfaceTexts.has(a.text)));
  const listed = new Set<PillSource>([...s.surface, ...shared].map((a) => a.source));
  const failing = s.disarmed
    ? (s.preflight ?? []).filter(
        (p) => p.state === "fail" && !p.id.startsWith("pilot:") && !listed.has(PREFLIGHT_SOURCE[p.id] ?? "preflight"),
      )
    : [];
  const preflight = pillAlerts({
    alerts: [],
    readiness: [],
    prearm: undefined,
    storagePct: null,
    preflightFailing: failing.map(({ id, label }) => ({ id, label })),
  });
  return [...s.surface, ...shared, ...preflight].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1,
  );
}

/** Re-render cadence so a pilot state ages out of the pill. */
const PILL_TICK_MS = 500;

export function usePillAlerts(droneId: string): PillAlert[] {
  const t = useTranslations("flightScreen.pill");
  const { alerts, label } = useCockpitAlertList(droneId);
  const { pilot, receivedAt } = usePilotState(droneId);
  const disarmed = useDroneStore((s) => s.armState === "disarmed");
  const nav = useNavSource(droneId).result;
  const navText = t("navSource", { kind: nav.kind });
  const disk = useAgentSystemStore((s) => s.status?.health?.disk_percent ?? null);
  // The focused agent's polls describe its own node; another drone (a direct
  // flight controller, or a node that is not focused) has no say in them.
  const focused = useAgentConnectionStore(
    (s) => s.agentUrl !== null && Boolean(s.nodeDeviceId) && resolveNodeId(s.nodeDeviceId ?? undefined) === droneId,
  );
  const agentNode = useNodeRegistryStore((s) => s.nodes[droneId]?.presence.agentIdentityKnown === true);
  const paired = focused || agentNode;
  const failures = useAgentConnectionStore((s) => s.consecutiveFailures);
  const preflight = useChecklistStore((s) => (s.droneId === droneId ? s.preflight : null));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), PILL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const surface: PillAlert[] = alerts.map((a) => ({
    id: `alert:${a.id}:${a.detail ?? ""}`,
    severity: a.level === "critical" ? "critical" : "warning",
    text: label(a),
    source: ALERT_SOURCE[a.id],
  }));
  if (nav.tone === "warn" || nav.tone === "crit") {
    surface.push({
      id: `nav:${nav.kind}:${nav.tone}`,
      severity: nav.tone === "crit" ? "critical" : "warning",
      text: navText,
      source: "nav_source",
    });
  }
  return pillAlertsFor({
    surface,
    pilot,
    pilotAgeMs: receivedAt !== null ? now - receivedAt : paired ? null : undefined,
    agentReachable: focused ? failures < AGENT_UNREACHABLE_FAILURES : undefined,
    disarmed,
    preflight,
    storagePct: typeof disk === "number" ? disk : null,
  });
}

const ICON = { ok: CircleCheck, warning: TriangleAlert, critical: OctagonAlert } as const;
const COLOR = { ok: "var(--fs-ok)", warning: "var(--fs-warn)", critical: "var(--fs-crit)" } as const;

export function StatusPill({ droneId }: { droneId: string }) {
  const alerts = usePillAlerts(droneId);
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set());
  // The list is a flight-screen sheet: one at a time, and the tips see it.
  const [open, setOpen] = useFlightSheet("status");
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => alerts.map((a) => a.id).join("|"), [alerts]);
  // While the list is open every alert in it counts as seen; opening and
  // closing it record them as acknowledged, so one that arrived while it was
  // open does not flash once it closes.
  const summary = pillSummary(alerts, open ? new Set([...acked, ...alerts.map((a) => a.id)]) : acked);
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
  }, [open, keys, ackShown, setOpen]);

  const Icon = ICON[summary.severity];
  return (
    <div ref={rootRef} className="fs-pill-wrap">
      <button
        type="button"
        className="fs-pill fs-hit"
        data-testid="status-pill"
        data-severity={summary.severity}
        data-flashing={summary.flashing ? "true" : "false"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${specString("cockpit.menu.status")}: ${summary.text}`}
        onClick={() => {
          ackShown(keys);
          setOpen((o) => !o);
        }}
        style={{ "--pill-color": COLOR[summary.severity] } as React.CSSProperties}
      >
        <Icon className="fs-ico" aria-hidden="true" />
        <span className="fs-pill-text" title={summary.text}>{summary.text}</span>
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
                  <li key={a.id} data-severity={a.severity}>
                    <A className="fs-ico" style={{ color: COLOR[a.severity] }} aria-hidden="true" />
                    <span className="fs-pill-item">{a.text}</span>
                    <span className="fs-pill-src">{pillSourceLabel(a.source)}</span>
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
