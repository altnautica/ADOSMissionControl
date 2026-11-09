"use client";

/**
 * @module cockpit/flight/TopBarCells
 * @description The top bar's read-only cells: battery (percent, time to the
 * reserve and the RTL-reserve marker on the gauge), link (signal bars, with
 * its text as the detail that may move into the Menu) and the controller.
 * Each subscribes to its own source so a telemetry tick re-renders only it.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Gamepad2, Radio } from "lucide-react";

import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";
import { specString } from "@/lib/cockpit/spec-strings";
import { Tour } from "@/components/config/ControlsSettingsCards";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { deriveHudStatus } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useBatteryBand, type BatteryBand } from "@/lib/battery-bands";
import { shortPadName, usePadStatusStore } from "@/lib/input/pad-status";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { linkStateFromHeartbeat, type LinkState } from "../band/link-state";
import { formatElapsed, msSince } from "../band/format";
import { useBandReserve } from "../band/use-band-reserve";

const BAND_COLOR: Record<BatteryBand, string> = {
  good: "var(--fs-ok)",
  warning: "var(--fs-warn)",
  critical: "var(--fs-crit)",
};

const LINK_COLOR: Record<LinkState, string> = {
  none: "var(--fs-text-dim)",
  ok: "var(--fs-text)",
  stale: "var(--fs-warn)",
  lost: "var(--fs-crit)",
};

export function BatteryCell({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.battery");
  const { battery } = useHudTopBarData();
  const armState = useDroneStore((s) => s.armState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const { batteryPct } = deriveHudStatus({ battery }, { armState, flightMode, lastHeartbeat });
  const band = useBatteryBand(batteryPct);
  const reserve = useBandReserve(droneId);
  const pct = batteryPct === null ? null : Math.max(0, Math.min(100, batteryPct));
  const color = band ? BAND_COLOR[band] : "var(--fs-text-dim)";
  const left =
    reserve === null ? null : reserve.etaS === null ? NO_DATA_GLYPH : formatElapsed(reserve.etaS * 1000);
  return (
    <div
      className="fs-cell fs-batt"
      data-testid="fs-battery"
      title={t("title")}
      aria-label={t("aria", { pct: pct === null ? NO_DATA_GLYPH : Math.round(pct), left: left ?? NO_DATA_GLYPH })}
    >
      <span className="fs-gauge" aria-hidden="true">
        <i style={{ width: `${pct ?? 0}%`, background: color }} />
        {reserve && (
          <b className="fs-reserve" data-testid="fs-battery-reserve" style={{ left: `${reserve.reservePct}%` }} />
        )}
      </span>
      <span className="fs-val" style={band && band !== "good" ? { color } : undefined}>
        {pct === null ? NO_DATA_GLYPH : `${Math.round(pct)}%`}
      </span>
      {left !== null && (
        <span className="fs-sub" data-testid="fs-battery-left" style={reserve?.past ? { color: "var(--fs-crit)" } : undefined}>
          {left}
        </span>
      )}
    </div>
  );
}

const SIG = [5, 8, 11, 14];

export function LinkCell({ droneId, detail }: { droneId: string; detail: boolean }) {
  const t = useTranslations("flightScreen.link");
  const { radio } = useHudTopBarData();
  const armState = useDroneStore((s) => s.armState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const polled = useNavStreamStore((s) => s.byDrone[droneId]?.transport === "poll");
  const { signalBars } = deriveHudStatus({ radio }, { armState, flightMode, lastHeartbeat });
  const link = linkStateFromHeartbeat(lastHeartbeat);
  const level = signalBars ?? (link === "ok" ? 4 : link === "stale" ? 1 : 0);
  const text = radio
    ? t("rssi", { v: Math.round(radio.rssi) })
    : link === "none"
      ? NO_DATA_GLYPH
      : link === "ok"
        ? t("ok")
        : t("age", { age: formatElapsed(msSince(lastHeartbeat)) });
  return (
    <div className="fs-cell" data-testid="fs-link" data-link-state={link} title={t("title")}>
      <span className="fs-sig" aria-hidden="true">
        {SIG.map((h, i) => (
          <b key={h} style={{ height: h, background: i < level ? LINK_COLOR[link] : "var(--fs-border)" }} />
        ))}
      </span>
      {detail && (
        <span className="fs-sub" data-testid="fs-link-detail" style={{ color: LINK_COLOR[link] }}>
          {text}
        </span>
      )}
      {polled && (
        <span role="status" data-testid="reduced-rate-chip" className="fs-sub fs-warn" title={t("reducedRate")}>
          <Radio className="fs-ico-sm" aria-hidden="true" />
          {detail ? t("reducedRate") : null}
        </span>
      )}
    </div>
  );
}

/**
 * The controller's state. Before any pad has reported it asks for a button
 * press (browsers expose a pad only after one). A pad whose layout is not
 * standard never streams sticks, so it reads "not supported".
 */
export function ControllerCell() {
  const t = useTranslations("flightScreen.controller");
  const pad = usePadStatusStore();
  if (!pad.seen && !pad.connected) {
    return (
      <div className="fs-cell" data-testid="cockpit-controller-chip" data-connected="false">
        <Gamepad2 className="fs-ico" aria-hidden="true" />
        <span className="fs-sub fs-trunc">{specString("controls.press_any_button")}</span>
      </div>
    );
  }
  const name = shortPadName(pad.name);
  const label = !pad.connected
    ? t("lost")
    : pad.needsCalibration
      ? specString("controls.not_standard")
      : (name ?? t("connected"));
  return (
    <div
      className={`fs-cell${pad.connected && pad.usable ? "" : " fs-warn"}`}
      data-testid="cockpit-controller-chip"
      data-connected={pad.connected}
      title={pad.name ?? undefined}
    >
      <Gamepad2 className="fs-ico" aria-hidden="true" />
      <span className="fs-sub fs-trunc">{label}</span>
    </div>
  );
}

/** A usable pad's first-connect tour, under the top bar's end. */
export function ControllerTour() {
  const pad = usePadStatusStore();
  const padId = useInputStore((s) => s.gamepadId);
  if (!pad.connected || !pad.usable || !padId) return null;
  return (
    <div className="fs-ctl-tour">
      <Tour padId={padId} />
    </div>
  );
}
