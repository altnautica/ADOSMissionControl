"use client";

/**
 * @module MissionWarningBanner
 * @description Top-center mission-validation banner shown inside the 3D
 * simulation viewer. Surfaces mission errors/warnings with an "Edit Plan" jump
 * and a dismiss control. Self-contained: it computes validation from the shared
 * mission waypoints (identical options to the Plan panel) so it can mount inside
 * the map-view container — centering over the map, not the whole page — without
 * threading validation state down from the page.
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { validateMission } from "@/lib/validation/mission-validator";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";

export function MissionWarningBanner({ waypoints }: { waypoints: Waypoint[] }) {
  const tSim = useTranslations("simulate");
  const router = useRouter();
  const validationOptions = useValidationOptions();
  // Track which waypoints array the banner was dismissed for. When the mission
  // changes (new array reference), `dismissed` derives back to false — the
  // banner reappears with no reset effect.
  const [dismissedFor, setDismissedFor] = useState<Waypoint[] | null>(null);
  const dismissed = dismissedFor === waypoints;

  // Shared options builder — matches the Plan panel exactly.
  const validation = useMemo(() => {
    if (waypoints.length === 0) return null;
    return validateMission(waypoints, validationOptions);
  }, [waypoints, validationOptions]);

  if (!validation || dismissed) return null;
  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  if (!hasErrors && !hasWarnings) return null;

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 max-w-md"
      style={{ zIndex: MAP_OVERLAY_Z.popover }}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-md text-xs font-mono ${
          hasErrors
            ? "bg-status-error/15 border-status-error/30 text-status-error"
            : "bg-status-warning/15 border-status-warning/30 text-status-warning"
        }`}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span className="flex-1">
          {hasErrors
            ? tSim("missionHasErrors", { count: validation.errors.length })
            : tSim("missionHasWarnings", { count: validation.warnings.length })}
        </span>
        <button
          onClick={() => router.push("/plan")}
          className="text-accent-primary hover:text-accent-primary/80 whitespace-nowrap cursor-pointer"
        >
          {tSim("editPlan")}
        </button>
        <button
          onClick={() => setDismissedFor(waypoints)}
          className="text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
