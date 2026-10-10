"use client";

/**
 * The cockpit alert stack, under the safety band on the alert layer.
 *
 * Three levels, each carried by an icon and a spoken level as well as colour:
 * `critical` (red border that flashes for three seconds, then holds steady;
 * announced assertively), `warning` (amber border pulse; announced politely)
 * and `advisory` (no motion). The text itself never flashes, and reduced
 * motion stops every animation. The rules live in `band/cockpit-alert-rules`.
 *
 * The drone and telemetry stores are scoped to the selected drone, so the
 * stack only speaks while this cockpit's drone is the selected one; another
 * drone's heartbeat must never age into this drone's link alert.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

/** MAV_SEVERITY_CRITICAL; lower values are more severe. */
const MAV_SEVERITY_CRITICAL = 2;

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

/** The latest critical and pre-arm STATUSTEXT lines from this drone's FC. */
function useFcTexts(droneId: string) {
  const protocol = useDroneManager((s) => s.drones.get(droneId)?.protocol);
  const [critical, setCritical] = useState<ReceivedText | null>(null);
  const [prearm, setPrearm] = useState<ReceivedText | null>(null);
  useEffect(() => {
    if (!protocol) return;
    return protocol.onStatusText(({ severity, text }) => {
      const at = Date.now();
      if (/^PreArm:/i.test(text)) setPrearm({ text: text.replace(/^PreArm:\s*/i, ""), at });
      else if (severity <= MAV_SEVERITY_CRITICAL || isFailsafeAnnouncement(severity, text)) {
        setCritical({ text, at });
      }
    });
  }, [protocol]);
  return { critical, prearm };
}

export function CockpitAlerts({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.alerts");
  useThrottledTelemetryVersion();
  useClockTick();

  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const armState = useDroneStore((s) => s.armState);
  const armedAt = useDroneStore((s) => s.armedAt);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const systemStatus = useDroneStore((s) => s.systemStatus);
  const flightMode = useDroneStore((s) => s.flightMode);
  const videoFrozen = useVideoStore((s) => s.isStreaming && s.degradedReason !== null);
  const { critical, prearm } = useFcTexts(droneId);

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
        prearmText: prearm,
      })
    : [];

  const label = (a: CockpitAlert): string => {
    if (a.id === "statusText") return a.detail ?? "";
    if (a.id === "prearm") return t("prearm", { reason: a.detail ?? "" });
    if (a.id === "fcState") return t(a.detail ?? "fcCritical");
    return t(a.id);
  };

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
          <span className="sr-only">{t(`level.${a.level}`)}: </span>
          <span className="truncate">{label(a)}</span>
        </div>
      );
    });

  return (
    <div
      className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ top: 72, zIndex: 45 }}
      data-testid="cockpit-alerts"
    >
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-1.5">
        {render(alerts.filter((a) => a.level === "critical"))}
      </div>
      <div aria-live="polite" className="flex flex-col items-center gap-1.5">
        {render(alerts.filter((a) => a.level !== "critical"))}
      </div>
    </div>
  );
}
