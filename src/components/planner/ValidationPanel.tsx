/**
 * @module ValidationPanel
 * @description Mission validation panel that auto-validates waypoints and displays
 * errors and warnings. Each issue is clickable to select the relevant waypoint.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { validateMission } from "@/lib/validation/mission-validator";
import type { ValidationIssue, ValidationResult } from "@/lib/validation/issue-types";
import { MissionAdvisories } from "./MissionAdvisories";

interface ValidationPanelProps {
  waypoints: Waypoint[];
  onSelectWaypoint: (id: string) => void;
}

export function ValidationPanel({
  waypoints,
  onSelectWaypoint,
}: ValidationPanelProps) {
  const t = useTranslations("validation");
  const tDock = useTranslations("planner.dock");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared builder so the Plan panel and the Simulate banner gate the fence
  // identically and both enforce zones + rally.
  const validationOptions = useValidationOptions();

  // Auto-validate on waypoint changes (debounced 500ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (waypoints.length === 0) {
      setResult(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const r = validateMission(waypoints, validationOptions);
      setResult(r);
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [waypoints, validationOptions]);

  const handleIssueClick = useCallback(
    (issue: ValidationIssue) => {
      if (issue.waypointId) {
        onSelectWaypoint(issue.waypointId);
      }
    },
    [onSelectWaypoint],
  );

  if (waypoints.length === 0) {
    return (
      <p className="text-[11px] text-text-tertiary">{t("addWaypointsToValidate")}</p>
    );
  }

  // Waiting for debounce
  if (!result) {
    return <span className="text-[11px] text-text-tertiary">{t("validating")}</span>;
  }

  const totalIssues = result.errors.length + result.warnings.length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Summary */}
      <div className="flex items-center gap-1.5">
        {result.valid && result.warnings.length === 0 ? (
          <>
            <CheckCircle size={12} className="text-status-success" />
            <span className="text-[11px] text-status-success">{t("missionValid")}</span>
          </>
        ) : result.valid ? (
          <>
            <AlertTriangle size={12} className="text-status-warning" />
            <span className="text-[11px] text-text-secondary">
              {tDock("warningCount", { count: result.warnings.length })}
            </span>
          </>
        ) : (
          <>
            <XCircle size={12} className="text-status-error" />
            <span className="text-[11px] text-text-secondary">
              {result.warnings.length > 0
                ? tDock("errorWarningCount", { errors: result.errors.length, warnings: result.warnings.length })
                : tDock("errorCount", { count: result.errors.length })}
            </span>
          </>
        )}
      </div>

      {/* Issue list */}
      {totalIssues > 0 && (
        <div className="flex flex-col gap-0.5">
          {result.errors.map((issue, i) => (
            <IssueRow key={`err-${i}`} issue={issue} onClick={handleIssueClick} />
          ))}
          {result.warnings.map((issue, i) => (
            <IssueRow key={`warn-${i}`} issue={issue} onClick={handleIssueClick} />
          ))}
        </div>
      )}

      {/* Advisory checks — never block an upload, surfaced below hard issues. */}
      <MissionAdvisories
        waypoints={waypoints}
        onSelectWaypoint={onSelectWaypoint}
      />
    </div>
  );
}

// ── Single issue row ────────────────────────────────────────

function IssueRow({
  issue,
  onClick,
}: {
  issue: ValidationIssue;
  onClick: (issue: ValidationIssue) => void;
}) {
  const tIssue = useTranslations("planner.issue");
  const isError = issue.severity === "blocking";

  return (
    <button
      type="button"
      onClick={() => onClick(issue)}
      className={`flex items-start gap-1.5 px-1.5 py-1 text-left cursor-pointer transition-colors hover:bg-bg-tertiary ${
        issue.waypointId ? "" : "cursor-default"
      }`}
    >
      {isError ? (
        <XCircle size={10} className="text-status-error shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle size={10} className="text-status-warning shrink-0 mt-0.5" />
      )}
      <span
        className={`text-[11px] ${
          isError ? "text-status-error" : "text-status-warning"
        }`}
      >
        {tIssue(issue.text.key, issue.text.params)}
      </span>
    </button>
  );
}
