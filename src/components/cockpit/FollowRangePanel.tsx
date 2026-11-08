"use client";

/**
 * @module cockpit/FollowRangePanel
 * @description The read-only range panel of following mode (instrument layer,
 * bottom-centre above the Skill Bar). Rows by width class: `compact` one
 * merged line, `medium` range + interval bar + height, `expanded`/`tv` add
 * geometry and the cue/latency row. A `follow.state` older than 2 s blanks
 * every value, dims the plate and reads STALE.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { FollowState } from "@/lib/agent/nav-types";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { formatRange, rangeInterval } from "@/lib/vision/target-format";
import {
  LATENCY_WARN_MS,
  PHASE_TONE,
  RANGE_CUE_ORDER,
  bearing3,
  intervalBar,
} from "@/lib/vision/follow-chrome";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { useFollowingMode } from "@/hooks/use-following-mode";

const CUE_KEY = { ground: "gnd", box_height: "box", lidar: "lidar" } as const;

const PHASE_KEY = {
  idle: "idle",
  acquiring: "acquiring",
  following: "following",
  coasting: "coasting",
  searching: "searching",
  holding: "holding",
  lost: "lost",
} as const;

function fixed1(v: number | null): string {
  return v === null ? NO_DATA_GLYPH : v.toFixed(1);
}

export function FollowRangePanel({ droneId }: { droneId: string }) {
  const t = useTranslations("hud.range");
  const widthClass = useCockpitWidthClass();
  const { follow, stale, following } = useFollowingMode(droneId);
  if (!following) return null;

  // Every value reads from `live`, which is null once the report is stale.
  const live: FollowState | null = stale ? null : follow;
  const blank = live === null;
  const phase = follow?.phase ?? "idle";
  const phaseWord = blank ? t("stale") : t(PHASE_KEY[phase]);
  const phaseColor = blank ? "var(--hud-warn)" : `var(--hud-${PHASE_TONE[phase]})`;
  const range = live?.rangeM ?? null;
  const sigma = live?.rangeSigmaM ?? null;
  const rangeText = range === null ? NO_DATA_GLYPH : formatRange(range);
  const aglSource = live?.aglSource ?? null;
  const sourceWord = aglSource === "baro" ? t("baro") : aglSource === "rng" ? t("rng") : null;
  const sourceStyle = aglSource === "baro" ? { color: "var(--hud-warn)" } : undefined;
  const agl = fixed1(live?.aglM ?? null);
  const dep = live?.depressionDeg ?? null;
  const brg = live?.bearingDeg ?? null;

  if (widthClass === "compact") {
    return (
      <div className="frp" data-width-class="compact" data-stale={blank ? "true" : undefined}
        role="status" aria-label={t("label")} data-testid="follow-range-panel">
        <div className="frp-line">
          <span className="frp-range">{rangeText}</span>
          {sigma !== null && range !== null && <span>±{sigma.toFixed(1)}</span>}
          <span className="frp-sep">·</span>
          <span>{t("agl")} {agl}</span>
          {sourceWord && <span style={sourceStyle}>{sourceWord}</span>}
          <span className="frp-phase" style={{ color: phaseColor }}>{phaseWord}</span>
        </div>
      </div>
    );
  }

  const bar = range !== null ? intervalBar(range, sigma) : null;
  const full = widthClass === "expanded" || widthClass === "tv";
  const latency = live?.pipelineLatencyMs ?? null;
  const cues = new Set(live?.rangeCues.map((c) => c.kind) ?? []);
  const mode = live?.reacquireMode ?? null;

  return (
    <div className="frp" data-width-class={widthClass} data-stale={blank ? "true" : undefined}
      role="status" aria-label={t("label")} data-testid="follow-range-panel">
      <div className="frp-row frp-head" data-row="range">
        <span className="frp-range">{rangeText}</span>
        <span className="frp-phase" style={{ color: phaseColor }}>{phaseWord}</span>
      </div>
      <div className="frp-row" data-row="interval">
        <span className="frp-track" aria-hidden="true">
          {bar && bar.lo !== null && bar.hi !== null && (
            <i className="frp-fill" style={{ left: `${bar.lo * 100}%`, width: `${(bar.hi - bar.lo) * 100}%` }} />
          )}
          {bar && <b className="frp-tick" style={{ left: `${bar.tick * 100}%` }} />}
        </span>
        <span className="frp-sub">
          {range !== null && sigma !== null ? rangeInterval(range, sigma) : NO_DATA_GLYPH}
        </span>
      </div>
      <div className="frp-row" data-row="height">
        <span>{t("agl")} {agl === NO_DATA_GLYPH ? agl : `${agl} m`}</span>
        {sourceWord && (
          <>
            <span className="frp-sep">·</span>
            <span style={sourceStyle}>{sourceWord}</span>
          </>
        )}
      </div>
      {full && (
        <div className="frp-row" data-row="geometry">
          <span>{t("dep")} {dep === null ? NO_DATA_GLYPH : `${Math.round(dep)}°`}</span>
          <span className="frp-sep">·</span>
          <span>{t("brg")} {brg === null ? NO_DATA_GLYPH : bearing3(brg)}</span>
          <span className="frp-sep">·</span>
          <span>{fixed1(live?.targetSpeedMps ?? null)} m/s</span>
        </div>
      )}
      {full && (
        <div className="frp-row" data-row="cues">
          {RANGE_CUE_ORDER.map((kind) => (
            <span key={kind} className="frp-cue" data-lit={cues.has(kind) ? "true" : "false"}>
              {t(CUE_KEY[kind])}
            </span>
          ))}
          <span className="frp-sep">·</span>
          <span style={latency !== null && latency > LATENCY_WARN_MS ? { color: "var(--hud-warn)" } : undefined}>
            {t("lat")} {latency === null ? NO_DATA_GLYPH : `${Math.round(latency)} ms`}
          </span>
          {mode && (
            <>
              <span className="frp-sep">·</span>
              <span>{t(mode)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
