/**
 * @module TemplatesPanel
 * @description A compact picker for the built-in mission templates. Each row
 * shows a name + one-line description; selecting one builds REAL waypoints from
 * the current map view via the shipped pattern generators (see
 * `@/lib/templates/mission-templates`) and loads them into the mission.
 *
 * Honesty rules enforced here:
 *  - Area templates read a drawn boundary when present; with none, they fall
 *    back to a box around the map center and the row SAYS SO (never a silent
 *    invention).
 *  - With the map still on the null island (0,0) every template is disabled
 *    with a hint rather than dropping waypoints in the ocean.
 *  - Loading a template into a non-empty plan asks for an inline confirm first,
 *    since it replaces every waypoint (and is undoable via the planner history).
 *
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useMemo, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Grid3x3, Map, Orbit, Spline, ScanSearch, Radar } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { useDrawingStore } from "@/stores/drawing-store";
import {
  MISSION_TEMPLATES,
  type MissionTemplate,
  type MissionTemplateContext,
} from "@/lib/templates/mission-templates";
import { sampleGroundElevations } from "@/lib/mission/sample-ground-elevations";
import { cn } from "@/lib/utils";

/** Icon per template id (falls back to the generic grid mark). */
const TEMPLATE_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  gridSurvey: Grid3x3,
  propertyMapping: Map,
  orbitInspection: Orbit,
  corridorScan: Spline,
  areaSearch: ScanSearch,
  sectorSearch: Radar,
};

export function TemplatesPanel() {
  const t = useTranslations("planner.templates");
  const { toast } = useToast();

  const mapCenter = usePlannerStore((s) => s.mapCenter);
  const defaultAlt = usePlannerStore((s) => s.defaultAlt);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  const polygons = useDrawingStore((s) => s.polygons);
  const waypointCount = useMissionStore((s) => s.waypoints.length);

  // Awaiting an inline "replace the current plan?" confirm for this template id.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const hasCenter = mapCenter[0] !== 0 || mapCenter[1] !== 0;
  // The most-recently drawn polygon is the boundary area templates read from.
  const boundary = useMemo<[number, number][] | undefined>(() => {
    const last = polygons[polygons.length - 1];
    return last && last.vertices.length >= 3 ? last.vertices : undefined;
  }, [polygons]);

  const apply = useCallback(
    (tpl: MissionTemplate) => {
      if (!hasCenter) {
        toast(t("noCenterHint"), "info");
        return;
      }
      const ctx: MissionTemplateContext = {
        center: mapCenter,
        boundary,
        altitude: defaultAlt,
        speed: defaultSpeed,
        frame: defaultFrame,
      };
      let waypoints;
      try {
        waypoints = tpl.build(ctx);
      } catch {
        toast(t("empty", { name: t(tpl.nameKey) }), "warning");
        return;
      }
      if (waypoints.length === 0) {
        toast(t("empty", { name: t(tpl.nameKey) }), "warning");
        return;
      }
      useMissionStore.getState().setWaypoints(waypoints);
      // Same as a pattern apply: terrain under every waypoint, so the terrain
      // clearance check and the chart have something to compare against.
      sampleGroundElevations(waypoints);
      toast(t("applied", { name: t(tpl.nameKey), count: waypoints.length }), "success");
    },
    [hasCenter, mapCenter, boundary, defaultAlt, defaultSpeed, defaultFrame, t, toast],
  );

  const handleSelect = useCallback(
    (tpl: MissionTemplate) => {
      if (!hasCenter) {
        toast(t("noCenterHint"), "info");
        return;
      }
      // Replacing a non-empty plan is gated behind an inline confirm.
      if (waypointCount > 0) {
        setPendingId(tpl.id);
        return;
      }
      apply(tpl);
    },
    [hasCenter, waypointCount, apply, t, toast],
  );

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <p className="text-[10px] text-text-tertiary font-mono px-0.5 pb-1">
        {t("intro")}
      </p>

      {!hasCenter && (
        <p className="text-[10px] text-status-warning font-mono px-0.5 pb-1">
          {t("noCenterHint")}
        </p>
      )}

      {MISSION_TEMPLATES.map((tpl) => {
        const Icon = TEMPLATE_ICONS[tpl.id] ?? Grid3x3;
        const isPending = pendingId === tpl.id;
        const showBoxHint = tpl.needsBoundary && !boundary;
        const showBoundaryHint = tpl.needsBoundary && !!boundary;
        return (
          <div key={tpl.id} className="flex flex-col">
            <button
              type="button"
              disabled={!hasCenter}
              onClick={() => handleSelect(tpl)}
              className={cn(
                "w-full flex items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
                "hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
                isPending && "bg-bg-tertiary",
              )}
            >
              <Icon size={13} className="mt-0.5 shrink-0 text-accent-primary" />
              <span className="min-w-0 flex flex-col">
                <span className="text-xs font-medium text-text-primary truncate">
                  {t(tpl.nameKey)}
                </span>
                <span className="text-[10px] text-text-tertiary leading-snug">
                  {t(tpl.descKey)}
                </span>
                {showBoxHint && (
                  <span className="text-[10px] text-text-tertiary font-mono mt-0.5">
                    {t("needsBoundaryHint")}
                  </span>
                )}
                {showBoundaryHint && (
                  <span className="text-[10px] text-accent-primary font-mono mt-0.5">
                    {t("usingBoundaryHint")}
                  </span>
                )}
              </span>
            </button>

            {isPending && (
              <div className="flex items-center gap-2 px-2 pb-1.5 pt-0.5">
                <span className="text-[10px] text-text-secondary flex-1">
                  {t("replaceConfirm")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingId(null);
                    apply(tpl);
                  }}
                  className="text-[10px] font-medium text-status-warning hover:underline cursor-pointer"
                >
                  {t("replace")}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingId(null)}
                  className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
                >
                  {t("cancel")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
