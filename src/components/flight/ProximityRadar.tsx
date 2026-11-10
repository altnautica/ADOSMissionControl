"use client";

/**
 * @module ProximityRadar
 * @description Proximity radar: OBSTACLE_DISTANCE wedges (caution / danger)
 * with an outlined arc at each sector's measured distance, the companion's
 * planar scan as dots, range rings at 1/3, 2/3 and the full display range
 * (3 / 6 / 12 m, auto or pinned by tapping the dial or `+` / `−`), and the
 * nearest-obstacle readout. The top of the dial is FWD for body-frame data
 * and N for north-aligned OBSTACLE_DISTANCE. Hidden until either source has
 * ever reported (an empty dial would read as "all clear"); dimmed with a `—`
 * readout once both are older than 2 s.
 * @license GPL-3.0-only
 */

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { specString } from "@/lib/cockpit/spec-strings";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useNavStateEntry } from "@/hooks/use-nav-feed";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";
import { cycleRadarScale, type RadarScaleSetting } from "@/lib/nav/radar-geometry";
import {
  RADAR_SIZE_BY_CLASS,
  buildRadarModel,
  keyRadarScale,
  radarDial,
  radarLowPower,
} from "@/components/flight/proximity-radar-model";

const TONE_VAR = { crit: "var(--hud-crit)", warn: "var(--hud-warn)" } as const;
const BAND_VAR = { danger: "var(--hud-crit)", caution: "var(--hud-warn)", clear: "var(--hud-good)" } as const;

interface ProximityRadarProps {
  /** Cockpit drone id; the scan and nav state come from its nav feed. */
  droneId?: string | null;
  /** Dial size in px; defaults to the cockpit width class size. */
  size?: number;
}

export function ProximityRadar({ droneId = null, size }: ProximityRadarProps) {
  const t = useTranslations("hud.radar");
  // The OBSTACLE_DISTANCE ring keeps its last sample forever: `_version` says
  // new data arrived and the clock tick says time passed, which is the only
  // signal after a link loss. Both re-run the freshness checks below.
  useTelemetryStore((s) => s._version);
  useClockTick();
  const widthClass = useCockpitWidthClass();
  const scan = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.scan : undefined));
  const nav = useNavStateEntry(droneId);
  const [setting, setSetting] = useState<RadarScaleSetting>("auto");

  const dialSize = size ?? RADAR_SIZE_BY_CLASS[widthClass];
  const telemetry = useTelemetryStore.getState();
  const obstacle = telemetry.obstacle.latest();
  const now = Date.now();
  const yawDeg = freshOnly(telemetry.attitude.latest(), now)?.yaw ?? null;
  const lowPower =
    typeof window !== "undefined" &&
    radarLowPower(window.location.search, document.documentElement.dataset.power);

  const model = buildRadarModel({ size: dialSize, now, obstacle, scan, nav, yawDeg, setting, lowPower });

  if (model.hidden) return null;

  const { c, R, inner } = radarDial(dialSize);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "+" || e.key === "=") setSetting(keyRadarScale(model.displayM, "+"));
    else if (e.key === "-" || e.key === "_") setSetting(keyRadarScale(model.displayM, "-"));
    else if (e.key === "Enter" || e.key === " ") setSetting(cycleRadarScale(setting));
    else return;
    e.preventDefault();
  };
  const scaleLabel =
    setting === "auto"
      ? specString("radar.scale_auto", { m: model.displayM })
      : specString("radar.scale", { m: model.displayM });
  const readout =
    model.nearestM === null
      ? model.stale
        ? "—"
        : t("clear")
      : `${specString("cockpit.unit.m", { n: model.nearestM.toFixed(1) })} ${model.band === "clear" ? t("clear") : specString(`radar.${model.band}`)}`;

  return (
    <div
      className="radar panel"
      data-stale={model.stale ? "true" : "false"}
      style={{ width: dialSize }}
      role="button"
      tabIndex={0}
      aria-label={specString("radar.cycle")}
      title={specString("radar.cycle")}
      onClick={() => setSetting(cycleRadarScale(setting))}
      onKeyDown={onKey}
    >
      <div className="rhead lbl">
        {model.rateHz !== null ? specString("radar.header", { hz: Math.round(model.rateHz) }) : specString("radar.scan_none")}
      </div>
      <svg viewBox={`0 0 ${dialSize} ${dialSize}`} width={dialSize} height={dialSize} aria-hidden="true">
        <g fill="none" stroke="var(--hud-hair)">
          {model.rings.map((ring) => (
            <circle key={ring.label} cx={c} cy={c} r={ring.r} />
          ))}
        </g>
        <g stroke="var(--hud-hair-2)">
          <line x1={c} y1={c - R} x2={c} y2={c + R} />
          <line x1={c - R} y1={c} x2={c + R} y2={c} />
        </g>
        {model.sectors.map((s, i) => (
          <g key={i} data-sector={s.tone}>
            <path
              d={s.wedge}
              fill={`color-mix(in oklch, ${TONE_VAR[s.tone]} 28%, transparent)`}
              stroke="none"
            />
            {s.arc && (
              <>
                <path d={s.arc} fill="none" stroke="var(--hud-glass-strong)" strokeWidth={4} />
                <path d={s.arc} fill="none" stroke={TONE_VAR[s.tone]} strokeWidth={2} data-arc="" />
              </>
            )}
          </g>
        ))}
        <g fill="var(--hud-ink)" fillOpacity={0.75}>
          {model.dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={1.5} data-dot="" />
          ))}
        </g>
        <circle cx={c} cy={c} r={Math.max(2, inner / 5)} fill="var(--hud-primary)" />
        {model.rings.map((ring) => (
          <text
            key={ring.label}
            x={ring.lx + 2}
            y={ring.ly - 2}
            fill="var(--hud-muted)"
            fontSize={9}
            fontFamily="var(--mono)"
            data-ring=""
          >
            {ring.label}
          </text>
        ))}
        <text
          x={c}
          y={c - R + 9}
          fill="var(--hud-muted)"
          fontSize={9}
          textAnchor="middle"
          fontFamily="var(--mono)"
          data-ref=""
        >
          {model.reference === "forward" ? "FWD" : "N"}
        </text>
      </svg>
      <div className="rscale lbl">{scaleLabel}</div>
      <div
        className="rlabel lbl"
        style={{ color: model.nearestM === null && model.stale ? "var(--hud-muted)" : BAND_VAR[model.band] }}
      >
        {readout}
      </div>
    </div>
  );
}
