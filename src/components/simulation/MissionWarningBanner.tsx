"use client";

/**
 * @module MissionWarningBanner
 * @description Top mission-validation banner shown inside the 3D simulation
 * viewer, centred in the space between the Map panel and the HUD. Names the
 * count and the first issue ("+n more" for the rest), with an "Edit Plan" jump
 * and a dismiss control. Self-contained: it computes validation from the shared
 * mission waypoints (identical options to the Plan panel) so it can mount inside
 * the map-view container without threading validation state down from the page.
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
  const tIssue = useTranslations("planner.issue");
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
  const issues = hasErrors ? validation.errors : validation.warnings;
  if (issues.length === 0) return null;
  const summary = hasErrors
    ? tSim("missionHasErrors", { count: validation.errors.length })
    : tSim("missionHasWarnings", { count: validation.warnings.length });
  const first = tIssue(issues[0].text.key, issues[0].text.params);
  const detail = issues.length > 1
    ? `${first} ${tSim("moreIssues", { count: issues.length - 1 })}`
    : first;

  return (
    // A strip across the top that keeps clear of the Map panel (top-left) and
    // the HUD (top-right), so the banner never covers either at narrow widths.
    <div
      data-testid="mission-warning-banner"
      className="absolute top-4 inset-x-0 flex justify-center pl-[19rem] pr-52 pointer-events-none"
      style={{ zIndex: MAP_OVERLAY_Z.popover }}
    >
      <div
        className={`pointer-events-auto flex min-w-0 max-w-md items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-md text-xs font-mono ${
          hasErrors
            ? "bg-status-error/15 border-status-error/30 text-status-error"
            : "bg-status-warning/15 border-status-warning/30 text-status-warning"
        }`}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span className="flex-1 min-w-0" title={detail}>
          <span className="block">{summary}</span>
          <span className="block truncate opacity-80">{detail}</span>
        </span>
        <button
          onClick={() => router.push("/plan")}
          className="min-h-8 px-1 inline-flex items-center text-accent-primary hover:text-accent-primary/80 whitespace-nowrap cursor-pointer"
        >
          {tSim("editPlan")}
        </button>
        <button
          onClick={() => setDismissedFor(waypoints)}
          aria-label={tSim("dismissWarning")}
          title={tSim("dismissWarning")}
          className="min-h-8 min-w-8 inline-flex items-center justify-center text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
