/**
 * @module PlannerCopilot
 * @description Keyless, fully-deterministic planner "copilot" input. The
 * operator types a plain-language mission ("survey at 80m, 75% overlap") and
 * the copilot maps it onto the pattern store via the shipped deterministic
 * modules — {@link parseMissionIntent} (regex intent parse) and
 * {@link quickSurveyFromBounds} (viewport → ready-to-run survey). No LLM, no
 * network, no fabricated geocode: a place name that cannot be resolved offline
 * is surfaced as a hint, never turned into invented coordinates.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, SquareDashed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { parseMissionIntent, type MissionIntent, type MissionPattern } from "@/lib/nl-intent-parser";
import { quickSurveyFromBounds, QUICK_SURVEY_MAX_PATH_M, type QuickSurveyEstimate } from "@/lib/ai/map-this-area";
import { DEFAULT_FC_ITEM_LIMIT } from "@/lib/validation/fc-item-count";
import {
  CAMERA_PROFILES,
  computeLineSpacing,
  computeTriggerDistance,
  type CameraProfile,
} from "@/lib/patterns/gsd-calculator";
import type { SurveyConfig } from "@/lib/patterns/types";
import { usePatternStore } from "@/stores/pattern-store";
import { selectPatternType } from "@/stores/pattern-selection";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePlannerStore } from "@/stores/planner-store";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { randomId, cn } from "@/lib/utils";

/** Pattern-store pattern types the copilot can activate from a parsed intent. */
export type CopilotPatternType = "survey" | "orbit" | "corridor";

/**
 * The survey config carries a few UI-only extended fields (overlap percentages
 * and the selected camera name) alongside the real {@link SurveyConfig}. Mirror
 * the shape `SurveyConfigSection` uses so overlap edits stay consistent.
 */
type SurveyConfigExt = Partial<SurveyConfig> & {
  _sidelap?: number;
  _frontlap?: number;
  _cameraName?: string;
};

/** A deterministic plan derived from a parsed {@link MissionIntent}. */
export interface CopilotPlan {
  /** Pattern type to activate, or null when none/unsupported. */
  patternType: CopilotPatternType | null;
  /** A pattern was recognized but has no generator yet (e.g. "perimeter"). */
  unsupportedPattern: MissionPattern | null;
  /** Altitude AGL to apply, metres. */
  altitudeM?: number;
  /** Cruise speed to apply, m/s. */
  speedMps?: number;
  /** Image overlap to apply (survey only), percent. */
  overlapPct?: number;
  /** Orbit radius to apply (orbit only), metres. */
  radiusM?: number;
  /** Place name that cannot be geocoded offline; a hint only, never coordinates. */
  place?: string;
  /** True when at least one field would actually change the plan. */
  actionable: boolean;
}

/** Deterministic map: parsed pattern → the pattern-store pattern the copilot sets. */
const PATTERN_TYPE_MAP: Record<MissionPattern, CopilotPatternType | null> = {
  survey: "survey",
  orbit: "orbit",
  corridor: "corridor",
  // No perimeter generator exists; recognized but not directly applicable.
  perimeter: null,
};

/** ~500 m half-span (degrees latitude) for the approximate map-center fallback. */
const APPROX_HALF_SPAN_DEG = 0.0045;
/** Overlap assumed for a map-this-area survey when none is stated, percent. */
const DEFAULT_MAP_OVERLAP_PCT = 70;
/** Altitude assumed for a map-this-area survey when none is stated, metres. */
const DEFAULT_MAP_ALTITUDE_M = 50;

/**
 * Turn a parsed {@link MissionIntent} into a deterministic {@link CopilotPlan}.
 * Pure: no store, no network. Only fields present in the intent are carried,
 * and `perimeter` (which has no generator) is flagged as unsupported rather
 * than silently dropped.
 */
export function planCopilotActions(intent: MissionIntent): CopilotPlan {
  const mapped = intent.pattern ? PATTERN_TYPE_MAP[intent.pattern] : null;
  const plan: CopilotPlan = {
    patternType: mapped,
    unsupportedPattern: intent.pattern && mapped === null ? intent.pattern : null,
    actionable: false,
  };
  if (intent.altitudeM !== undefined) plan.altitudeM = intent.altitudeM;
  if (intent.speedMps !== undefined) plan.speedMps = intent.speedMps;
  if (intent.overlapPct !== undefined) plan.overlapPct = intent.overlapPct;
  if (intent.radiusM !== undefined) plan.radiusM = intent.radiusM;
  if (intent.place !== undefined) plan.place = intent.place;
  plan.actionable =
    plan.patternType !== null ||
    plan.altitudeM !== undefined ||
    plan.speedMps !== undefined ||
    plan.overlapPct !== undefined ||
    plan.radiusM !== undefined;
  return plan;
}

/** What the copilot actually changed, so the chips reflect reality, not intent. */
interface AppliedSummary {
  pattern?: CopilotPatternType;
  altitudeM?: number;
  speedMps?: number;
  overlapPct?: number;
  radiusM?: number;
}

/** Find a camera profile by name, or undefined. */
function findCamera(name: string | undefined): CameraProfile | undefined {
  return name ? CAMERA_PROFILES.find((c) => c.name === name) : undefined;
}

/** Side / front overlap the survey controls show when none is stored, percent. */
const DEFAULT_SIDELAP_PCT = 60;
const DEFAULT_FRONTLAP_PCT = 70;

/**
 * Set the survey overlap and, when a camera is selected, recompute line
 * spacing (from sidelap) and trigger distance (from frontlap) at the current
 * altitude, exactly as the manual survey controls do. With no camera only the
 * overlap fields are set (no fabricated spacing).
 */
function applySurveyOverlap(sidelapPct: number, frontlapPct: number): void {
  const store = usePatternStore.getState();
  const cfg = store.surveyConfig as SurveyConfigExt;
  const camera = findCamera(cfg._cameraName);
  const update: SurveyConfigExt = { _sidelap: sidelapPct, _frontlap: frontlapPct };
  if (camera) {
    const alt = cfg.altitude ?? DEFAULT_MAP_ALTITUDE_M;
    update.lineSpacing = Math.round(computeLineSpacing(alt, camera, sidelapPct / 100) * 10) / 10;
    update.cameraTriggerDistance = Math.round(computeTriggerDistance(alt, camera, frontlapPct / 100) * 10) / 10;
  }
  store.updateSurveyConfig(update as Partial<SurveyConfig>);
}

/**
 * Execute a plan against the pattern store and report what actually changed.
 * Switching pattern type clears drawn shapes by design, so it is only done when
 * the type genuinely changes — tuning the active pattern's numbers never wipes
 * the operator's geometry.
 */
export function applyCopilotPlan(plan: CopilotPlan): AppliedSummary {
  const store = usePatternStore.getState();
  const applied: AppliedSummary = {};

  if (plan.patternType && plan.patternType !== store.activePatternType) {
    selectPatternType(plan.patternType);
  }
  if (plan.patternType) applied.pattern = plan.patternType;

  const active = usePatternStore.getState().activePatternType;

  const numeric: { altitude?: number; speed?: number } = {};
  if (plan.altitudeM !== undefined) {
    numeric.altitude = plan.altitudeM;
    applied.altitudeM = plan.altitudeM;
  }
  if (plan.speedMps !== undefined) {
    numeric.speed = plan.speedMps;
    applied.speedMps = plan.speedMps;
  }
  if (numeric.altitude !== undefined || numeric.speed !== undefined) {
    // Survey is the canonical numeric home (per the survey-first config); mirror
    // into the active pattern's own config so orbit/corridor keep the values.
    store.updateSurveyConfig(numeric);
    if (active === "orbit") store.updateOrbitConfig(numeric);
    else if (active === "corridor") store.updateCorridorConfig(numeric);
  }

  // Radius only has a home on an orbit; skip it (and its chip) otherwise.
  if (plan.radiusM !== undefined && active === "orbit") {
    store.updateOrbitConfig({ radius: plan.radiusM });
    applied.radiusM = plan.radiusM;
  }

  if (plan.overlapPct !== undefined) {
    applySurveyOverlap(plan.overlapPct, plan.overlapPct);
    applied.overlapPct = plan.overlapPct;
  } else if (numeric.altitude !== undefined) {
    // The camera footprint scales with altitude: keep the stored overlap true
    // at the new height rather than leaving spacing tuned for the old one.
    const cfg = usePatternStore.getState().surveyConfig as SurveyConfigExt;
    if (findCamera(cfg._cameraName)) {
      applySurveyOverlap(cfg._sidelap ?? DEFAULT_SIDELAP_PCT, cfg._frontlap ?? DEFAULT_FRONTLAP_PCT);
    }
  }

  return applied;
}

/** Feedback the copilot shows after a submit / map-this-area. */
type Feedback =
  | { kind: "idle" }
  | { kind: "applied"; intent: MissionIntent; plan: CopilotPlan; applied: AppliedSummary }
  | { kind: "mapped"; approx: boolean; altitudeM: number; overlapPct: number; estimate: QuickSurveyEstimate }
  | { kind: "tooLarge"; estimate: QuickSurveyEstimate }
  | { kind: "notUnderstood" }
  | { kind: "noMapArea" };

/** A small token-styled chip for a parsed / applied field. */
function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-text-secondary bg-bg-tertiary border border-border-default rounded-sm">
      {label}
    </span>
  );
}

export function PlannerCopilot() {
  const t = useTranslations("planner");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  // Keep the last parsed intent so Map-this-area can honour a just-typed
  // altitude / overlap without re-parsing.
  const [lastIntent, setLastIntent] = useState<MissionIntent | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const intent = parseMissionIntent(text);
      if (!intent) {
        setLastIntent(null);
        setFeedback({ kind: "notUnderstood" });
        return;
      }
      setLastIntent(intent);
      const plan = planCopilotActions(intent);
      const applied = applyCopilotPlan(plan);
      setFeedback({ kind: "applied", intent, plan, applied });
    },
    [text],
  );

  const handleMapThisArea = useCallback(() => {
    const planner = usePlannerStore.getState();
    let bounds = planner.mapBounds;
    let approx = false;
    if (!bounds) {
      const c = planner.mapCenter;
      if (c[0] === 0 && c[1] === 0) {
        setFeedback({ kind: "noMapArea" });
        return;
      }
      // Viewport bounds not reported yet: use an approximate box around the map
      // center and say so, rather than block.
      bounds = {
        north: c[0] + APPROX_HALF_SPAN_DEG,
        south: c[0] - APPROX_HALF_SPAN_DEG,
        east: c[1] + APPROX_HALF_SPAN_DEG,
        west: c[1] - APPROX_HALF_SPAN_DEG,
      };
      approx = true;
    }

    const store = usePatternStore.getState();
    const surveyCfg = store.surveyConfig as SurveyConfigExt;
    const altitudeM = lastIntent?.altitudeM ?? surveyCfg.altitude ?? DEFAULT_MAP_ALTITUDE_M;
    const overlapPct = lastIntent?.overlapPct ?? surveyCfg._sidelap ?? DEFAULT_MAP_OVERLAP_PCT;
    const camera = findCamera(surveyCfg._cameraName);

    const { polygon, config, estimate } = quickSurveyFromBounds(bounds, { altitudeM, overlapPct, camera });
    // A zoomed-out viewport would generate a mission no FC can hold and no
    // battery can fly; refuse it before touching the plan.
    if (estimate.items > DEFAULT_FC_ITEM_LIMIT || estimate.pathLengthM > QUICK_SURVEY_MAX_PATH_M) {
      setFeedback({ kind: "tooLarge", estimate });
      return;
    }

    // Fresh slate: selecting a pattern clears drawn shapes, then add our rectangle
    // (mirrors SurveyConfigSection's Quick Rect via the drawing store).
    selectPatternType("survey");
    useDrawingStore.getState().addPolygon({ id: randomId(), vertices: polygon, area: polygonArea(polygon) });

    // Apply the suggested grid config; the drawn polygon (not config.polygon) is
    // the geometry source, so strip it before merging.
    const gridConfig: Partial<SurveyConfig> = { ...config };
    delete gridConfig.polygon;
    store.updateSurveyConfig(gridConfig);
    store.generate();

    setLastIntent(null);
    setFeedback({ kind: "mapped", approx, altitudeM, overlapPct, estimate });
  }, [lastIntent]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Sparkles size={12} className="text-accent-primary" />
        <span>{t("copilot.hint")}</span>
      </div>

      <form onSubmit={handleSubmit} className="flex items-stretch gap-1.5">
        <div className="flex-1">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("copilot.placeholder")}
            aria-label={t("copilot.title")}
          />
        </div>
        <button
          type="submit"
          disabled={text.trim().length === 0}
          className={cn(
            "flex items-center gap-1 px-2 h-8 text-xs font-mono border transition-colors cursor-pointer shrink-0",
            "border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          )}
        >
          <Sparkles size={12} /> {t("copilot.apply")}
        </button>
      </form>

      <button
        type="button"
        onClick={handleMapThisArea}
        className="flex items-center justify-center gap-1.5 px-2 h-8 text-xs font-mono text-text-secondary border border-border-default hover:border-accent-primary/40 hover:text-text-primary transition-colors cursor-pointer"
      >
        <SquareDashed size={12} /> {t("copilot.mapThisArea")}
      </button>

      {feedback.kind === "notUnderstood" && (
        <p className="text-[10px] text-text-tertiary">{t("copilot.notUnderstood")}</p>
      )}

      {feedback.kind === "noMapArea" && (
        <p className="text-[10px] text-status-warning">{t("copilot.noMapArea")}</p>
      )}

      {feedback.kind === "tooLarge" && (
        <p className="text-[10px] text-status-warning">
          {t("copilot.tooLarge", {
            items: feedback.estimate.items,
            km: (feedback.estimate.pathLengthM / 1000).toFixed(1),
          })}
        </p>
      )}

      {feedback.kind === "mapped" && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-status-success">{t("copilot.mappedSummary")}</p>
          <p className="text-[10px] text-text-tertiary">
            {t("copilot.mappedEstimate", {
              lines: feedback.estimate.transects,
              items: feedback.estimate.items,
              km: (feedback.estimate.pathLengthM / 1000).toFixed(1),
            })}
          </p>
          <div className="flex flex-wrap gap-1">
            <Chip label={t("copilot.chipAltitude", { value: feedback.altitudeM })} />
            <Chip label={t("copilot.chipOverlap", { value: feedback.overlapPct })} />
          </div>
          {feedback.approx && (
            <p className="text-[10px] text-text-tertiary">{t("copilot.mappedApprox")}</p>
          )}
        </div>
      )}

      {feedback.kind === "applied" && (
        <div className="flex flex-col gap-1">
          {(feedback.applied.pattern !== undefined ||
            feedback.applied.altitudeM !== undefined ||
            feedback.applied.overlapPct !== undefined ||
            feedback.applied.speedMps !== undefined ||
            feedback.applied.radiusM !== undefined) && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-status-success font-mono mr-0.5">{t("copilot.applied")}</span>
              {feedback.applied.pattern !== undefined && (
                <Chip label={t("copilot.chipPattern", { pattern: feedback.applied.pattern })} />
              )}
              {feedback.applied.altitudeM !== undefined && (
                <Chip label={t("copilot.chipAltitude", { value: feedback.applied.altitudeM })} />
              )}
              {feedback.applied.overlapPct !== undefined && (
                <Chip label={t("copilot.chipOverlap", { value: feedback.applied.overlapPct })} />
              )}
              {feedback.applied.speedMps !== undefined && (
                <Chip label={t("copilot.chipSpeed", { value: feedback.applied.speedMps })} />
              )}
              {feedback.applied.radiusM !== undefined && (
                <Chip label={t("copilot.chipRadius", { value: feedback.applied.radiusM })} />
              )}
            </div>
          )}
          {feedback.plan.unsupportedPattern && (
            <p className="text-[10px] text-status-warning">
              {t("copilot.patternUnsupported", { pattern: feedback.plan.unsupportedPattern })}
            </p>
          )}
          {feedback.plan.place && (
            <p className="text-[10px] text-text-tertiary">
              {t("copilot.placeUnresolved", { place: feedback.plan.place })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
