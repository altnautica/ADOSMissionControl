/**
 * The cockpit SAFETY BAND: the ADOS wordmark + node·mode, then always-on
 * safety stats (ARMED pill, battery bar, GPS/RTK, link signal bars, flight
 * time). Styling lives in `.ados-cockpit .safety`; this component only feeds
 * live, freshness-gated values. Altitude/speed live on the tapes, not here.
 *
 * The band is ALWAYS on — safety-critical status is never hideable. The
 * operator's "top bar" chrome toggle only drops the decorative wordmark + node
 * label via {@link CockpitTopBarProps.lean}; the arm / battery / GPS / link
 * stats and the record/immersive controls stay visible in both states.
 *
 * @module fly/CockpitTopBar
 * @license GPL-3.0-only
 */

"use client";

import { memo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { needsOperatorAttention } from "@/lib/nodes/mqtt-control-authority";
import { useClockTick } from "@/lib/agent/freshness";
import { deriveHudStatus } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useBatteryBand, type BatteryBand } from "@/lib/battery-bands";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

/** Battery bar fill per severity band (the operator's configured thresholds). */
const BATTERY_BAND_FILL: Record<BatteryBand, string> = {
  good: "var(--good)",
  warning: "var(--warn)",
  critical: "var(--crit)",
};

/**
 * mm:ss flight clock, measured from the vehicle's arm transition.
 *
 * The elapsed time is derived from `armedAt` in the drone store rather than
 * from a `Date.now()` captured inside an effect, because the effect version
 * restarted at 0:00 on every remount: leaving the cockpit for the map and
 * coming back reset the flight timer mid-flight, which made it a
 * component-lifetime clock wearing a flight-time label.
 *
 * `Date.now()` on the render path trips `react-hooks/purity`, and it stays:
 * reading the wall clock is the entire job of a clock, `useClockTick()` is
 * what makes it advance, and the alternative — deriving from the clock
 * store's once-per-second `now` snapshot — is seeded at module load, so a
 * component mounting minutes later would render a badly wrong first frame.
 * A cosmetically pure clock that lies on mount is the worse trade.
 */
function useFlightTimer(armedAt: number | null): string {
  useClockTick();
  if (armedAt === null) return "--:--";
  const elapsedSec = Math.max(0, Math.floor((Date.now() - armedAt) / 1000));
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface CockpitTopBarProps {
  onExit?: () => void;
  controls?: ReactNode;
  /** Drop the decorative wordmark + node·mode label for a clean safety-only
   * strip (the operator hid the "top bar" chrome). The safety stats + controls
   * are unaffected — safety is never hidden. */
  lean?: boolean;
}

const SIG_HEIGHTS = [4, 7, 10, 13];

function CockpitTopBarInner({ onExit, controls, lean = false }: CockpitTopBarProps) {
  const t = useTranslations("cockpit");
  const { radio, battery, gps } = useHudTopBarData();
  const rawMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const armedAt = useDroneStore((s) => s.armedAt);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);

  // Battery, GPS and link on this band are freshness-gated by
  // `useHudTopBarData`; arm state and mode used to be read STRAIGHT from
  // drone-store, so with nothing connected the band rendered the store
  // defaults "disarmed" / "STABILIZE" as though they were measured — a safety
  // strip asserting a confirmed-safe state it never observed. They go through
  // the same heartbeat gate the canvas HUD uses (`hud-draw-status`), which
  // renders the no-data glyph for null. Battery percent comes from the same
  // derivation, which reads the FC's -1 ("capacity unknown") as no reading.
  const { armed, mode, signalBars, batteryPct } = deriveHudStatus(
    { battery, gps, radio },
    { armState, flightMode: rawMode, lastHeartbeat },
  );

  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const displayName = useDroneMetadataStore((s) =>
    selectedDroneId ? s.profiles[selectedDroneId]?.displayName : undefined,
  );
  // A direct-connect session has no stored profile; its managed name is the
  // label, never the bare session id.
  const sessionName = useDroneManager((s) =>
    selectedDroneId ? s.drones.get(selectedDroneId)?.name : undefined,
  );
  const name = displayName ?? sessionName ?? selectedDroneId ?? t("noDrone");

  const timer = useFlightTimer(armedAt);

  const batteryBandLevel = useBatteryBand(batteryPct);
  const batteryLow = batteryBandLevel === "critical";
  const batWidth = batteryPct !== null ? Math.max(0, Math.min(100, batteryPct)) : 0;

  // The locale already carried gpsRtk / gps3d / gps2d / gpsNoFix; this band was
  // building its own English strings beside them, so the one surface an
  // operator stares at during a flight was the one that never translated.
  // A stale or absent GPS sample is no data, not "no fix". Only fix types 5
  // (RTK float) and 6 (RTK fixed) are RTK; STATIC (7) and PPP (8) are 3D fixes.
  const fix = gps?.fixType;
  const sats = fmt(gps?.satellites, 0);
  const gpsLabel =
    fix === undefined
      ? NO_DATA_GLYPH
      : fix === 5 || fix === 6
        ? t("strip.gpsRtk", { sats })
        : fix >= 3
          ? t("strip.gps3d", { sats })
          : fix >= 2
            ? t("strip.gps2d", { sats })
            : t("strip.gpsNoFix");

  // 0 bars and "no reading" are different states: `signalBars` is null when
  // nothing has reported a link, 0 when a link was measured and is dead.
  const level = signalBars ?? 0;
  const rssi = radio ? fmt(radio.rssi, 0) : NO_DATA_GLYPH;

  // LINK above is the vehicle's own radio: how well the aircraft hears its
  // transmitter. It says nothing about whether this browser can reach the
  // aircraft, and on the cloud relay the two diverge completely — a strong RF
  // link with a receive-only relay credential means the pilot is watching a
  // healthy aircraft they cannot command. Surfaced only when authority is
  // limited or ending, because a band that carries a chip at all times trains
  // the eye to skip it.
  const authority = useMqttControlAuthority();
  const commandWarning = needsOperatorAttention(authority)
    ? authority.fcFrames === "provisioning"
      ? t("command.provisioning")
      : authority.fcFrames === "expiring"
        ? t("command.expiring")
        : t("command.receiveOnly")
    : null;

  return (
    <div className="safety">
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          aria-label={t("exit")}
          title={t("exit")}
          className="pointer-events-auto mr-1 flex items-center text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          style={{ background: "none", border: 0, cursor: "pointer" }}
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {!lean && (
        <>
          <span className="brand">ADOS</span>
          <span className="node">
            {name} · {mode ?? NO_DATA_GLYPH}
          </span>
        </>
      )}
      <span className="spacer" />

      {/* ARMED / DISARMED pill. `armed === null` means no live heartbeat backs
          either reading, and a stale "DISARMED" reads as a confirmed safe
          state — so it renders the no-data glyph instead. */}
      <div className="stat">
        {armed === null ? (
          <span className="pill mode">{NO_DATA_GLYPH}</span>
        ) : armed ? (
          <span className="pill armed">
            <i className="led" />
            {t("armed").toUpperCase()}
          </span>
        ) : (
          <span className="pill mode">{t("disarmed").toUpperCase()}</span>
        )}
      </div>

      {/* battery */}
      <div className="stat">
        <span className="k">{t("band.batt")}</span>
        <span className="bar">
          <i style={{ width: `${batWidth}%`, background: batteryBandLevel ? BATTERY_BAND_FILL[batteryBandLevel] : undefined }} />
        </span>
        <span className="v" style={batteryLow ? { color: "var(--crit)" } : undefined}>
          {fmt(batteryPct, 0)}%
        </span>
      </div>

      {/* GPS */}
      <div className="stat" data-testid="cockpit-gps">
        <span className="k">{t("strip.gps")}</span>
        <span className="v" style={fix === 5 || fix === 6 ? { color: "var(--good)" } : undefined}>
          {gpsLabel}
        </span>
      </div>

      {/* link */}
      <div className="stat">
        <span className="k">{t("strip.link")}</span>
        <span className="sig">
          {SIG_HEIGHTS.map((h, i) => (
            <b
              key={h}
              style={{ height: h, background: i < level ? "var(--good)" : "rgba(255,255,255,0.18)" }}
            />
          ))}
        </span>
        <span className="v">{rssi}</span>
      </div>

      {/* command authority — only when the pilot cannot fully command */}
      {commandWarning && (
        <div className="stat" role="status">
          <span className="k">{t("command.label")}</span>
          <span className="v" style={{ color: "var(--warn, #f5a524)" }}>
            {commandWarning}
          </span>
        </div>
      )}

      {/* flight time */}
      <div className="stat d-std">
        <span className="k">{t("band.time")}</span>
        <span className="v">{timer}</span>
      </div>

      {controls && (
        <div className="stat pointer-events-auto">{controls}</div>
      )}
    </div>
  );
}

export const CockpitTopBar = memo(CockpitTopBarInner);
