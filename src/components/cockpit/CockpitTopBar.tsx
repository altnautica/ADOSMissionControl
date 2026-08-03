/**
 * The cockpit SAFETY BAND — a faithful port of the reference artifact's
 * `.safety` strip: the ADOS wordmark + node·mode, then always-on safety stats
 * (ARMED pill, battery bar, GPS/RTK, link signal bars, flight time). Styling is
 * the artifact's (`.ados-cockpit .safety`); here we only feed live, freshness-
 * gated values (Rule 44). Altitude/speed live on the tapes, not here.
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

import { memo, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { needsOperatorAttention } from "@/lib/nodes/mqtt-control-authority";

const LOW_BATTERY_PERCENT = 20;

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

/** Battery bar fill color by remaining %. */
function batColor(pct: number | undefined | null): string {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return "var(--warn)";
  if (pct > 50) return "var(--good)";
  if (pct > 25) return "var(--warn)";
  return "var(--crit)";
}

/** Signal quality → 0..4 bars, honestly derived from the same rssi shown. */
function sigLevel(rssi: number | undefined | null): number {
  if (rssi === undefined || rssi === null || !Number.isFinite(rssi)) return 0;
  const q =
    rssi <= 0 ? Math.min(1, Math.max(0, (rssi + 95) / 45)) : Math.min(1, Math.max(0, rssi / 255));
  return Math.round(q * 4);
}

/** mm:ss flight clock, started when the vehicle first arms and reset on disarm. */
function useFlightTimer(armed: boolean): string {
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!armed) return;
    const startedAt = Date.now();
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [armed]);
  if (!armed) return "--:--";
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
  const mode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const armed = armState === "armed";

  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const displayName = useDroneMetadataStore((s) =>
    selectedDroneId ? s.profiles[selectedDroneId]?.displayName : undefined,
  );
  const name = displayName ?? selectedDroneId ?? t("noDrone");

  const timer = useFlightTimer(armed);

  const batteryPct = battery?.remaining;
  const batteryLow =
    typeof batteryPct === "number" && Number.isFinite(batteryPct) && batteryPct <= LOW_BATTERY_PERCENT;
  const batWidth =
    typeof batteryPct === "number" && Number.isFinite(batteryPct)
      ? Math.max(0, Math.min(100, batteryPct))
      : 0;

  const fix = gps?.fixType ?? 0;
  const sats = fmt(gps?.satellites, 0);
  const gpsLabel =
    fix >= 5 ? `RTK · ${sats}` : fix >= 3 ? `3D · ${sats}` : fix >= 2 ? `2D · ${sats}` : "NO FIX";

  const level = sigLevel(radio?.rssi);
  const rssi = radio ? fmt(radio.rssi, 0) : "--";

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
            {name} · {mode}
          </span>
        </>
      )}
      <span className="spacer" />

      {/* ARMED / DISARMED pill */}
      <div className="stat">
        {armed ? (
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
          <i style={{ width: `${batWidth}%`, background: batColor(batteryPct) }} />
        </span>
        <span className="v" style={batteryLow ? { color: "var(--crit)" } : undefined}>
          {fmt(batteryPct, 0)}%
        </span>
      </div>

      {/* GPS */}
      <div className="stat">
        <span className="k">{t("strip.gps")}</span>
        <span className="v" style={fix >= 5 ? { color: "var(--good)" } : undefined}>
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
