"use client";

/**
 * @module cockpit/flight/TopBarCells
 * @description The top bar's read-only cells: battery (percent, time to the
 * reserve and the RTL-reserve marker on the gauge), link (signal bars and
 * the age of the newest vehicle frame, the text being the detail that may
 * move into the Menu; RSSI lives in the link popover) and the controller.
 * Each subscribes to its own source so a telemetry tick re-renders only it.
 *
 * @license GPL-3.0-only
 */

import { useRef, useState, type CSSProperties } from "react";
import { Gamepad2, Radio } from "lucide-react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useDroneStore } from "@/stores/drone-store";
import { specString } from "@/lib/cockpit/spec-strings";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { deriveHudStatus } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useBatteryBand, type BatteryBand } from "@/lib/battery-bands";
import { shortPadName, usePadStatusStore } from "@/lib/input/pad-status";
import { useClockTick } from "@/lib/agent/freshness";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { linkStateFromHeartbeat, type LinkState } from "../band/link-state";
import { formatElapsed } from "../band/format";
import { useBandReserve } from "../band/use-band-reserve";
import { SEVERITY_VAR } from "./flight-context";
import { FlightSheetPortal, useFlightRoot, useFlightSheet, useSheetDismiss } from "./flight-sheet";

const BAND_COLOR: Record<BatteryBand, string> = {
  good: "var(--fs-ok)",
  warning: "var(--fs-warn)",
  critical: "var(--fs-crit)",
};

interface TopBarZoneSpec {
  id: string;
  link?: {
    text: string;
    never: string;
    icon_color: { ok_below_ms: number; warning_below_ms: number };
  };
  battery?: { time_to_reserve?: { text: string; short: string } };
}

const TOP_BAR = (layoutSpec.zones as unknown as TopBarZoneSpec[]).find((z) => z.id === "top_bar");
const LINK_SPEC = TOP_BAR?.link ?? {
  text: "cockpit.link.age",
  never: "cockpit.link.never",
  icon_color: { ok_below_ms: 3000, warning_below_ms: 10000 },
};
const RESERVE_SPEC = TOP_BAR?.battery?.time_to_reserve ?? {
  text: "battery.to_reserve",
  short: "battery.to_reserve_short",
};

/** The battery cell's time-to-reserve text: the full form, or the short one
 * when the bar is short of room. */
export function reserveText(left: string, short: boolean): string {
  return specString(short ? RESERVE_SPEC.short : RESERVE_SPEC.text, { t: left });
}

export function BatteryCell({ droneId, short = false }: { droneId: string; short?: boolean }) {
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
  const pctText = pct === null ? NO_DATA_GLYPH : `${Math.round(pct)}%`;
  const name = specString("cockpit.status.source.battery");
  const full = left === null ? `${name} ${pctText}` : `${name} ${pctText}, ${reserveText(left, false)}`;
  return (
    <div className="fs-cell fs-batt" data-testid="fs-battery" title={full} aria-label={full}>
      <span className="fs-gauge" aria-hidden="true">
        <i style={{ width: `${pct ?? 0}%`, background: color }} />
        {reserve && (
          <b className="fs-reserve" data-testid="fs-battery-reserve" style={{ left: `${reserve.reservePct}%` }} />
        )}
      </span>
      <span className="fs-val" style={band && band !== "good" ? { color } : undefined}>
        {pctText}
      </span>
      {left !== null && (
        <span
          className={`fs-sub${reserve?.past ? " fs-text-crit" : ""}`}
          data-testid="fs-battery-left"
          data-short={short ? "true" : "false"}
        >
          {reserveText(left, short)}
        </span>
      )}
    </div>
  );
}

const SIG = [5, 8, 11, 14];

export type LinkSeverity = "none" | "ok" | "warning" | "critical";

/**
 * The link cell's reading of the newest vehicle frame: its age in whole
 * seconds (or "no link" when none has arrived) and the icon's severity by
 * the spec's thresholds.
 */
export function linkAgeView(lastFrameAt: number, now: number): { text: string; severity: LinkSeverity } {
  if (!(lastFrameAt > 0)) return { text: specString(LINK_SPEC.never), severity: "none" };
  const age = Math.max(0, now - lastFrameAt);
  const { ok_below_ms, warning_below_ms } = LINK_SPEC.icon_color;
  return {
    text: specString(LINK_SPEC.text, { s: Math.floor(age / 1000) }),
    severity: age < ok_below_ms ? "ok" : age < warning_below_ms ? "warning" : "critical",
  };
}

const LINK_COLOR: Record<LinkSeverity, string> = { none: "var(--fs-text-dim)", ...SEVERITY_VAR };

/** The link's detail lines: RSSI, and the reduced update rate when polled. */
function LinkDetail({ droneId }: { droneId: string }) {
  const { radio } = useHudTopBarData();
  const polled = useNavStreamStore((s) => s.byDrone[droneId]?.transport === "poll");
  return (
    <>
      <span className="fs-sub" data-testid="fs-link-rssi">
        {specString("cockpit.link.rssi", { v: radio ? Math.round(radio.rssi) : NO_DATA_GLYPH })}
      </span>
      {polled && (
        <span role="status" data-testid="reduced-rate-chip" className="fs-sub fs-warn">
          <Radio className="fs-ico-sm" aria-hidden="true" />
          {specString("nav.reduced_rate")}
        </span>
      )}
    </>
  );
}

/**
 * The link cell. On the bar it is a button that opens the link popover (RSSI
 * and the update rate) below the top bar; in the Menu's overflow section the
 * same lines show inline.
 */
export function LinkCell({ droneId, detail, inMenu = false }: { droneId: string; detail: boolean; inMenu?: boolean }) {
  useClockTick();
  const { radio } = useHudTopBarData();
  const armState = useDroneStore((s) => s.armState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const polled = useNavStreamStore((s) => s.byDrone[droneId]?.transport === "poll");
  const { signalBars } = deriveHudStatus({ radio }, { armState, flightMode, lastHeartbeat });
  const link: LinkState = linkStateFromHeartbeat(lastHeartbeat);
  const { text, severity } = linkAgeView(lastHeartbeat, Date.now());
  // At least one bar is lit once a frame has arrived, so the icon carries
  // the age's colour even with no signal reading.
  const bars = signalBars ?? (link === "ok" ? 4 : link === "stale" ? 1 : 0);
  const level = severity === "none" ? bars : Math.max(1, bars);
  const color = LINK_COLOR[severity];
  const named = specString("cockpit.link.named", { label: text });
  const [open, setOpen] = useFlightSheet("link");
  const cellRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const root = useFlightRoot();
  const [popLeft, setPopLeft] = useState(8);
  useSheetDismiss(popRef, () => setOpen(false), "[data-sheet-trigger='link']", open && !inMenu);

  const body = (
    <>
      <span className="fs-sig" aria-hidden="true" data-testid="fs-link-icon" data-severity={severity}>
        {SIG.map((h, i) => (
          <b key={h} style={{ height: h, background: i < level ? color : "var(--fs-border)" }} />
        ))}
      </span>
      {detail && (
        <span className="fs-sub" data-testid="fs-link-detail" data-item="link_text" style={{ color }}>
          {text}
        </span>
      )}
      {polled && (
        <span role="status" className="fs-sub fs-warn" title={specString("nav.reduced_rate")} aria-label={specString("nav.reduced_rate")}>
          <Radio className="fs-ico-sm" aria-hidden="true" />
        </span>
      )}
    </>
  );

  if (inMenu) {
    return (
      <div className="fs-cell" data-testid="fs-link" data-item="link_icon" data-link-state={link} aria-label={named}>
        {body}
        <LinkDetail droneId={droneId} />
      </div>
    );
  }

  const toggle = () => {
    const cell = cellRef.current?.getBoundingClientRect();
    const frame = root?.getBoundingClientRect();
    if (cell && frame) setPopLeft(Math.max(8, Math.round(cell.left - frame.left)));
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={cellRef}
        type="button"
        className="fs-cell fs-cell-btn fs-hit"
        data-testid="fs-link"
        data-item="link_icon"
        data-link-state={link}
        data-sheet-trigger="link"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={named}
        aria-label={named}
        onClick={toggle}
      >
        {body}
      </button>
      {open && (
        <FlightSheetPortal>
          <div
            ref={popRef}
            role="dialog"
            aria-label={named}
            className="fs-sheet fs-link-pop"
            data-testid="fs-link-popover"
            style={{ position: "absolute", left: popLeft, top: "calc(var(--fs-bar-b, 0px) + 8px)" } as CSSProperties}
          >
            <span className="fs-val" style={{ color }}>
              {text}
            </span>
            <LinkDetail droneId={droneId} />
          </div>
        </FlightSheetPortal>
      )}
    </>
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
