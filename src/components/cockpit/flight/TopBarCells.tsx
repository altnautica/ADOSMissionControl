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
import { specString } from "@/lib/cockpit/spec-strings";
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
  const named = specString("cockpit.link.named", { label: text });
  return (
    <div
      className="fs-cell"
      data-testid="fs-link"
      data-item="link_icon"
      data-link-state={link}
      title={named}
      aria-label={named}
    >
      <span className="fs-sig" aria-hidden="true">
        {SIG.map((h, i) => (
          <b key={h} style={{ height: h, background: i < level ? LINK_COLOR[link] : "var(--fs-border)" }} />
        ))}
      </span>
      {detail && (
        <span className="fs-sub" data-testid="fs-link-detail" data-item="link_text" style={{ color: LINK_COLOR[link] }}>
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
 * The controller's state in the shared spec's words. Browsers expose a pad
 * only after its first button press: before any pad has reported this
 * session the cell reads "no controller"; once one has and is gone again it
 * asks for a press. A connected pad reads as a pad, or as not standard when
 * its layout never streams sticks.
 */
export function ControllerCell() {
  const pad = usePadStatusStore();
  const name = shortPadName(pad.name);
  const label = name ? specString("cockpit.controller.named", { name }) : specString("cockpit.controller");
  const state: "none" | "seen" | "connected" | "not_standard" = !pad.connected
    ? pad.seen
      ? "seen"
      : "none"
    : pad.needsCalibration
      ? "not_standard"
      : "connected";
  const text =
    state === "none"
      ? specString("controls.no_controller")
      : state === "seen"
        ? specString("controls.press_any_button")
        : state === "not_standard"
          ? specString("controls.pad.not_standard")
          : specString("controls.pad.connected", { battery: "" });
  return (
    <div
      className={`fs-cell${state === "not_standard" ? " fs-warn" : ""}`}
      data-testid="cockpit-controller-chip"
      data-item="controller"
      data-connected={pad.connected}
      data-pad={state}
      aria-label={`${label}: ${text}`}
      title={label}
    >
      <Gamepad2 className="fs-ico" aria-hidden="true" />
      <span className="fs-sub fs-trunc">{text}</span>
    </div>
  );
}
