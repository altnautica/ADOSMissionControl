"use client";

/**
 * The cockpit alert stack, under the safety band on the alert layer.
 *
 * Three levels, each carried by an icon and a spoken level as well as colour:
 * `critical` (red border that flashes for three seconds, then holds steady;
 * announced assertively), `warning` (amber border pulse; announced politely)
 * and `advisory` (no motion). The text itself never flashes, and reduced
 * motion stops every animation. The rules live in `band/cockpit-alert-rules`.
 * A follow-me re-acquisition adds a 4 s advisory naming the new track.
 *
 * The drone and telemetry stores are scoped to the selected drone, so the
 * stack only speaks while this cockpit's drone is the selected one; another
 * drone's heartbeat must never age into this drone's link alert.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useVideoStore } from "@/stores/video-store";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useClockTick } from "@/lib/agent/freshness";
import { deriveHudStatus } from "@/lib/hud-readings";
import { useBatteryBand } from "@/lib/battery-bands";
import { isFailsafeAnnouncement } from "@/lib/telemetry/failsafe-text";
import {
  deriveCockpitAlerts,
  type CockpitAlert,
  type CockpitAlertLevel,
  type ReceivedText,
} from "./band/cockpit-alert-rules";
import { useHudCopy } from "@/hooks/use-hud-copy";
import { reacquiredToast } from "@/lib/vision/target-format";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { specString } from "@/lib/cockpit/spec-strings";

/** Alert titles from the spec (`alert.*`, the same ids as the shared pill
 *  rules). The FC's own lines, the pre-arm reason and the FC state carry
 *  their detail and are composed in `label`. */
export const SPEC_ALERT_KEY: Record<
  Exclude<CockpitAlert["id"], "statusText" | "statusTextWarn" | "prearm" | "fcState">,
  string
> = {
  linkLost: "alert.link_lost",
  linkStale: "alert.link_stale",
  battCrit: "alert.batt_crit",
  battLow: "alert.batt_low",
  videoFrozen: "alert.video_frozen",
  ekfFailsafe: "alert.ekf_failsafe",
  fenceBreach: "alert.fence_breach",
  gpsNo3d: "alert.gps_no_3d",
  rcFailsafe: "alert.rc_failsafe",
  highVibration: "alert.high_vibration",
};

/** MAV_SEVERITY_CRITICAL and MAV_SEVERITY_WARNING; lower values are more severe. */
const MAV_SEVERITY_CRITICAL = 2;
const MAV_SEVERITY_WARNING = 4;

const LEVEL_STYLE: Record<CockpitAlertLevel, { color: string; Icon: typeof Info }> = {
  critical: { color: "var(--hud-crit)", Icon: OctagonAlert },
  warning: { color: "var(--hud-warn)", Icon: TriangleAlert },
  advisory: { color: "var(--hud-ink-2)", Icon: Info },
};

const LEVEL_CLASS: Record<CockpitAlertLevel, string> = {
  critical: "cockpit-alert crit",
  warning: "cockpit-alert warn",
  advisory: "cockpit-alert",
};

/** The latest critical, warning and pre-arm STATUSTEXT lines from this drone's FC. */
function useFcTexts(droneId: string) {
  const protocol = useDroneManager((s) => s.drones.get(droneId)?.protocol);
  const [critical, setCritical] = useState<ReceivedText | null>(null);
  const [warning, setWarning] = useState<ReceivedText | null>(null);
  const [prearm, setPrearm] = useState<ReceivedText | null>(null);
  useEffect(() => {
    if (!protocol) return;
    return protocol.onStatusText(({ severity, text }) => {
      const at = Date.now();
      if (/^PreArm:/i.test(text)) setPrearm({ text: text.replace(/^PreArm:\s*/i, ""), at });
      else if (severity <= MAV_SEVERITY_CRITICAL || isFailsafeAnnouncement(severity, text)) {
        setCritical({ text, at });
      } else if (severity <= MAV_SEVERITY_WARNING) {
        setWarning({ text, at });
      }
    });
  }, [protocol]);
  return { critical, warning, prearm };
}

/** How long the re-acquired advisory stays up. */
export const REACQUIRED_ADVISORY_MS = 4000;

/** The re-acquired advisory text while the latest `follow.reacquired` event
 * is under 4 s old; shown once per event, never re-raised. */
function useReacquiredAdvisory(droneId: string): string | null {
  const event = useNavStreamStore((s) => s.byDrone[droneId]?.followEvent);
  const copy = useHudCopy();
  const [now, setNow] = useState(Date.now);
  const until =
    event && event.data.topic === "follow.reacquired" ? event.receivedAt + REACQUIRED_ADVISORY_MS : 0;
  // Re-render when the advisory expires; until then the event's own arrival
  // time stands in for the clock.
  useEffect(() => {
    if (until === 0) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()) + 5);
    return () => window.clearTimeout(id);
  }, [until]);
  if (!event || event.data.topic !== "follow.reacquired") return null;
  const age = Math.max(now, event.receivedAt) - event.receivedAt;
  return age < REACQUIRED_ADVISORY_MS ? reacquiredToast(event.data, copy) : null;
}

/**
 * Every live cockpit alert for this drone, most severe first, with its
 * display text. The critical ones are also drawn as banners under the top
 * bar; the status pill counts and lists all of them.
 */
export function useCockpitAlertList(droneId: string): {
  alerts: CockpitAlert[];
  label: (a: CockpitAlert) => string;
} {
  useThrottledTelemetryVersion();
  useClockTick();

  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const armState = useDroneStore((s) => s.armState);
  const armedAt = useDroneStore((s) => s.armedAt);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const systemStatus = useDroneStore((s) => s.systemStatus);
  const flightMode = useDroneStore((s) => s.flightMode);
  const videoFrozen = useVideoStore((s) => s.isStreaming && s.degradedReason !== null);
  const { critical, warning, prearm } = useFcTexts(droneId);

  const buffers = useTelemetryStore.getState();
  const battery = buffers.battery.latest();
  // -1 ("capacity unknown") and a stale sample both read as no reading, and
  // an unknown battery never alerts.
  const { batteryPct } = deriveHudStatus({ battery }, { armState, flightMode, lastHeartbeat });
  const batteryBand = useBatteryBand(batteryPct);

  const alerts: CockpitAlert[] = selected
    ? deriveCockpitAlerts({
        armState,
        armedAt,
        lastHeartbeat,
        systemStatus,
        batteryBand,
        fence: buffers.fenceStatus.latest(),
        ekf: buffers.ekf.latest(),
        sysStatus: buffers.sysStatus.latest(),
        gps: buffers.gps.latest(),
        vibration: buffers.vibration.latest(),
        videoFrozen,
        criticalText: critical,
        warningText: warning,
        prearmText: prearm,
      })
    : [];

  const label = (a: CockpitAlert): string => {
    if (a.id === "statusText" || a.id === "statusTextWarn") return a.detail ?? "";
    if (a.id === "prearm") return `${specString("alert.prearm")}: ${a.detail ?? ""}`;
    if (a.id === "fcState") {
      const state = specString(`alert.fc_state.${a.detail ?? "critical"}`);
      return `${specString("cockpit.status.source.fc_status_text")} ${state}`;
    }
    return specString(SPEC_ALERT_KEY[a.id]);
  };
  return { alerts, label };
}

/**
 * Critical alerts as banners under the top bar, plus the short-lived
 * re-acquired advisory. Warnings and advisories live in the status pill's
 * list, so the centre stays clear unless something is critical.
 */
export function CockpitAlerts({ droneId }: { droneId: string }) {
  const { alerts, label } = useCockpitAlertList(droneId);
  const reacquired = useReacquiredAdvisory(droneId);

  const render = (list: CockpitAlert[]) =>
    list.map((a) => {
      const { color, Icon } = LEVEL_STYLE[a.level];
      return (
        <div
          key={`${a.id}:${a.detail ?? ""}`}
          data-testid={`cockpit-alert-${a.id}`}
          data-level={a.level}
          className={`${LEVEL_CLASS[a.level]} flex max-w-[28rem] items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wide`}
          style={{
            color: "var(--hud-ink)",
            background: `color-mix(in oklch, ${color} 18%, var(--hud-glass-strong))`,
            border: `1px solid ${color}`,
          }}
        >
          <Icon size={14} style={{ color, flex: "none" }} aria-hidden="true" />
          <span className="sr-only">{specString(`alert.level.${a.level}`)}: </span>
          <span className="truncate">{label(a)}</span>
        </div>
      );
    });

  return (
    <div
      className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ top: "calc(var(--fs-top-y, 60px))", zIndex: 45 }}
      data-testid="cockpit-alerts"
      data-zone="alert_stack"
    >
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-1.5">
        {render(alerts.filter((a) => a.level === "critical"))}
      </div>
      <div aria-live="polite" className="flex flex-col items-center gap-1.5">
        {reacquired && (
          <div
            data-testid="cockpit-alert-reacquired"
            data-level="advisory"
            className={`${LEVEL_CLASS.advisory} flex max-w-[28rem] items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs`}
            style={{
              color: "var(--hud-ink)",
              background: `color-mix(in oklch, ${LEVEL_STYLE.advisory.color} 18%, var(--hud-glass-strong))`,
              border: `1px solid ${LEVEL_STYLE.advisory.color}`,
            }}
          >
            <Info size={14} style={{ color: LEVEL_STYLE.advisory.color, flex: "none" }} aria-hidden="true" />
            <span className="sr-only">{specString("alert.level.advisory")}: </span>
            <span className="truncate">{reacquired}</span>
          </div>
        )}
      </div>
    </div>
  );
}
