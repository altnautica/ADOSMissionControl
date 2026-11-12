"use client";

/**
 * @module cockpit/FollowRangePanel
 * @description The read-only range panel of following mode. It sits in the
 * follow strip under the top bar as one line (`variant="line"`): the range
 * to the target, only when the skill measures it, and the phase. The line
 * carries no height above the ground: the bottom row owns that readout. The
 * full panel (range + interval bar + height, then geometry and the
 * cue/latency row at `expanded`/`tv`) opens as a sheet from the strip. A
 * `follow.state` older than 2 s blanks every value, dims the plate and reads
 * STALE.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { specString } from "@/lib/cockpit/spec-strings";
import type { FollowState } from "@/lib/hud/nav-types";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { formatRange, rangeInterval } from "@/lib/vision/target-format";
import {
  LATENCY_WARN_MS,
  PHASE_TONE,
  RANGE_CUE_ORDER,
  bearing3,
  intervalBar,
} from "@/lib/hud/follow-chrome";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { useFollowingMode } from "@/hooks/use-following-mode";

const MODE_KEY = { strict: "follow.mode.strict", smart: "follow.mode.smart" } as const;

function fixed1(v: number | null): string {
  return v === null ? NO_DATA_GLYPH : v.toFixed(1);
}

export function FollowRangePanel({
  droneId,
  variant,
}: {
  droneId: string;
  /** `line` forces the one-line form; `detail` the full panel at any width. */
  variant?: "line" | "detail";
}) {
  const t = useTranslations("hud.range");
  const cockpitClass = useCockpitWidthClass();
  const widthClass = variant === "detail" && cockpitClass === "compact" ? "medium" : cockpitClass;
  const { follow, stale, following } = useFollowingMode(droneId);
  if (!following) return null;

  // Every value reads from `live`, which is null once the report is stale.
  const live: FollowState | null = stale ? null : follow;
  const blank = live === null;
  const phase = follow?.phase ?? "idle";
  const phaseWord = specString(`follow.phase.${blank ? "stale" : phase}`);
  const phaseColor = blank ? "var(--hud-warn)" : `var(--hud-${PHASE_TONE[phase]})`;
  const range = live?.rangeM ?? null;
  const sigma = live?.rangeSigmaM ?? null;
  const rangeText = range === null ? NO_DATA_GLYPH : formatRange(range);
  const aglSource = live?.aglSource ?? null;
  const sourceWord = aglSource === "baro" ? specString("agl.source.baro") : aglSource === "rng" ? t("rng") : null;
  const sourceStyle = aglSource === "baro" ? { color: "var(--hud-warn)" } : undefined;
  const agl = fixed1(live?.aglM ?? null);
  const dep = live?.depressionDeg ?? null;
  const brg = live?.bearingDeg ?? null;

  if (variant === "line" || widthClass === "compact") {
    // A skill that measures the target's distance reports a range or range
    // cues; a stale report keeps the slot (blank) rather than dropping it.
    const measures = follow !== null && (follow.rangeM !== null || follow.rangeCues.length > 0);
    return (
      <div className="frp" data-width-class="compact" data-stale={blank ? "true" : undefined}
        role="status" aria-label={specString("follow.range")} data-testid="follow-range-panel">
        <div className="frp-line">
          {measures && <span className="frp-range" data-testid="follow-range-value">{rangeText}</span>}
          {measures && sigma !== null && range !== null && <span className="frp-aux">±{sigma.toFixed(1)}</span>}
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
      role="status" aria-label={specString("follow.range")} data-testid="follow-range-panel">
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
        <span>{specString("cockpit.readout.agl")} {agl === NO_DATA_GLYPH ? agl : `${agl} m`}</span>
        {sourceWord && (
          <>
            <span className="frp-sep">·</span>
            <span style={sourceStyle}>{sourceWord}</span>
          </>
        )}
      </div>
      {full && (
        <div className="frp-row" data-row="geometry">
          <span>{specString("follow.geo.depression", { v: dep === null ? NO_DATA_GLYPH : `${Math.round(dep)}°` })}</span>
          <span className="frp-sep">·</span>
          <span>{specString("follow.geo.bearing", { v: brg === null ? NO_DATA_GLYPH : bearing3(brg) })}</span>
          <span className="frp-sep">·</span>
          <span>{fixed1(live?.targetSpeedMps ?? null)} m/s</span>
        </div>
      )}
      {full && (
        <div className="frp-row" data-row="cues">
          {RANGE_CUE_ORDER.map((kind) => (
            <span key={kind} className="frp-cue" data-lit={cues.has(kind) ? "true" : "false"}>
              {specString(`follow.cue.${kind}`)}
            </span>
          ))}
          <span className="frp-sep">·</span>
          <span style={latency !== null && latency > LATENCY_WARN_MS ? { color: "var(--hud-warn)" } : undefined}>
            {specString("follow.latency", { v: latency === null ? NO_DATA_GLYPH : `${Math.round(latency)} ms` })}
          </span>
          {mode && (
            <>
              <span className="frp-sep">·</span>
              <span>{specString(MODE_KEY[mode])}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
