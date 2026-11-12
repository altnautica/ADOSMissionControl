/**
 * @module SendToVehicleDialog
 * @description One place to send the plan to the selected vehicle: the
 * mission and, when present and supported, the geofence and rally points.
 * Items run in order; a failure is reported on its row and the rest still run.
 *
 * Every row is blocked while the target vehicle is armed and flying a mission
 * (AUTO / MISSION): a new mission replaces the one being flown under the
 * vehicle, which keeps flying whatever lands at its current index, and a
 * fence or rally swap changes its limits mid-flight. In resume
 * mode the mission row uploads the mission that picks the plan up at a
 * waypoint, in place of the plan itself.
 * @license GPL-3.0-only
 */
"use client";

import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Plane, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { validateMission } from "@/lib/validation/mission-validator";
import { buildFenceElements } from "@/lib/geofence-elements";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { useReportedVehicleProfile } from "@/hooks/use-plan-profile";
import { sameProfile } from "@/lib/mission/plan-profile";
import type { PlanVehicleProfile } from "@/lib/types";
import { isFlyingMission } from "@/lib/mission/upload-guard";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS, countCheckedPreflightItems } from "@/components/planner/preflight-items";
import { flyThisMission } from "@/components/planner/fly-this-mission";
import { useDescribeUploadFailure } from "@/components/planner/use-describe-upload-failure";
import type { Planner } from "@/app/plan/use-planner";

type SendItem = "mission" | "geofence" | "rally";
const ORDER: readonly SendItem[] = ["mission", "geofence", "rally"];

/** Mission errors that mean the mission crosses the plan's own fence. */
const FENCE_BREACH_CODES: Record<string, true> = {
  OUTSIDE_GEOFENCE: true,
  LEG_OUTSIDE_GEOFENCE: true,
  INSIDE_EXCLUSION_ZONE: true,
};

interface TransferResult {
  success: boolean;
  message: string;
  /** On failure, the vehicle's MAV_MISSION_RESULT or a GCS-side outcome code. */
  resultCode?: number;
}

type RowState =
  | { status: "running" }
  | { status: "ok" | "failed"; message: string };

interface SendToVehicleDialogProps {
  open: boolean;
  onClose: () => void;
  p: Planner;
  showGeofence: boolean;
  showRally: boolean;
  /** Resume mode: the mission row uploads the plan resumed at this planner waypoint index. */
  resumeFromIndex?: number;
}

export function SendToVehicleDialog({ open, onClose, p, showGeofence, showRally, resumeFromIndex }: SendToVehicleDialogProps) {
  const t = useTranslations("planner.send");
  const router = useRouter();
  const setDock = usePlannerStore((s) => s.setDock);

  // The upload goes to the drone selected in the drone manager, which can
  // differ from the vehicle the plan is assigned to; name it and offer a switch.
  const targetId = useDroneManager((s) => s.selectedDroneId);
  const planDroneId = p.selectedDroneId;
  const planDroneConnected = useDroneManager((s) => !!planDroneId && s.drones.has(planDroneId));
  const nameOf = (id: string) => p.drones.find((d) => d.id === id)?.name ?? id;
  const targetName = targetId ? nameOf(targetId) : null;
  const mismatch = !!targetId && !!planDroneId && planDroneId !== targetId && planDroneConnected;
  // The target's own mission state, never the selected drone's.
  const flyingMission = isFlyingMission(useMissionStatus(targetId));
  // A plan written for one autopilot or vehicle class, sent to another.
  const planProfile = useMissionStore((s) => s.vehicleProfile);
  const targetProfile = useReportedVehicleProfile(targetId);
  const profileMismatch = !!planProfile && !!targetProfile && !sameProfile(planProfile, targetProfile);
  const describeProfile = (profile: PlanVehicleProfile) =>
    `${t(`autopilot.${profile.autopilot}`)} ${t(`vehicleClass.${profile.vehicleClass}`)}`;

  const validationOptions = useValidationOptions();
  const describeUploadFailure = useDescribeUploadFailure();
  const { errorCount, crossesFence } = useMemo(() => {
    const errors = p.waypoints.length > 0 ? validateMission(p.waypoints, validationOptions).errors : [];
    return {
      errorCount: errors.length,
      // A fence the plan's own mission breaks: sending it would leave the
      // vehicle holding a fence that its mission flies through.
      crossesFence: errors.some((e) => FENCE_BREACH_CODES[e.code] === true),
    };
  }, [p.waypoints, validationOptions]);

  const fenceType = useGeofenceStore((s) => s.fenceType);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const zones = useGeofenceStore((s) => s.zones);
  const fenceHasGeometry = useMemo(
    () => buildFenceElements(fenceType, polygonPoints, circleCenter, circleRadius, zones).length > 0,
    [fenceType, polygonPoints, circleCenter, circleRadius, zones],
  );
  const rallyCount = useRallyStore((s) => s.points.length);
  const uploadProgress = useMissionStore((s) => s.uploadProgress);

  const checkedCount = countCheckedPreflightItems(usePreflightChecklistStore((s) => s.checked));

  const available: Record<SendItem, boolean> = {
    mission: p.waypoints.length > 0,
    geofence: showGeofence && fenceHasGeometry,
    rally: showRally && rallyCount > 0,
  };
  const blocked: Record<SendItem, boolean> = {
    mission: errorCount > 0 || flyingMission,
    geofence: crossesFence || flyingMission,
    rally: flyingMission,
  };
  const items = ORDER.filter((item) => available[item]);

  const [deselected, setDeselected] = useState<Partial<Record<SendItem, boolean>>>({});
  const [rows, setRows] = useState<Partial<Record<SendItem, RowState>>>({});
  const [running, setRunning] = useState(false);
  // Each opening starts fresh: everything applicable selected, no results.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDeselected({});
      setRows({});
    }
  }

  const isSelected = (item: SendItem) => !blocked[item] && !deselected[item];
  const selected = items.filter(isSelected);

  const runners: Record<SendItem, () => Promise<TransferResult>> = {
    mission: () => p.handleUpload(resumeFromIndex),
    geofence: () => useGeofenceStore.getState().uploadFence(),
    rally: () => useRallyStore.getState().uploadRallyPoints(),
  };

  const handleSend = async () => {
    const plan = selected;
    setRunning(true);
    setRows({});
    for (const item of plan) {
      setRows((r) => ({ ...r, [item]: { status: "running" } }));
      let result: TransferResult;
      try {
        result = await runners[item]();
      } catch (err) {
        result = { success: false, message: err instanceof Error ? err.message : String(err) };
      }
      // A fence or rally refusal carries the vehicle's result code: put it
      // into words through the same table the mission row uses.
      const message =
        !result.success && result.resultCode !== undefined
          ? (describeUploadFailure(result.resultCode, result.message) ?? result.message)
          : result.message;
      setRows((r) => ({ ...r, [item]: { status: result.success ? "ok" : "failed", message } }));
    }
    setRunning(false);
  };

  const openDock = (tab: "issues" | "checklist") => {
    setDock(tab, true);
    onClose();
  };

  const labels: Record<SendItem, string> = {
    mission: resumeFromIndex !== undefined
      ? t("resumeMission", { n: resumeFromIndex + 1 })
      : t("mission", { count: p.waypoints.length }),
    geofence: t("geofence"),
    rally: t("rally", { count: rallyCount }),
  };
  const statusLabels: Record<RowState["status"], string> = {
    running: t("statusRunning"),
    ok: t("statusOk"),
    failed: t("statusFailed"),
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      size="sm"
      closeBlocked={running}
      disableBackdropClose={running}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" disabled={running} onClick={onClose}>
            {Object.keys(rows).length > 0 ? t("close") : t("cancel")}
          </Button>
          {/* Once the mission is on the drone, the next step is flying it:
              its Flight tab, with Launch set to start the mission. */}
          {rows.mission?.status === "ok" && !running && targetId ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plane size={14} />}
              onClick={() => {
                flyThisMission(targetId, (href) => router.push(href));
                onClose();
              }}
            >
              {t("flyMission")}
            </Button>
          ) : (
            <Button variant="primary" size="md" loading={running} disabled={selected.length === 0} onClick={() => void handleSend()}>
              {running ? t("sending") : t("send")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-xs text-text-secondary">{t("nothing")}</p>
        ) : (
          <>
            <p className="text-xs text-text-secondary">{t("intro")}</p>
            {targetName && <p className="text-xs text-text-primary">{t("target", { name: targetName })}</p>}
            {mismatch && targetName && (
              <div className="flex items-center gap-2 text-[11px] text-status-warning" data-testid="send-target-mismatch">
                <span className="flex-1">{t("targetMismatch", { plan: nameOf(planDroneId), target: targetName })}</span>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => useDroneManager.getState().selectDrone(planDroneId)}
                  className="underline cursor-pointer hover:text-text-primary focus-ring shrink-0"
                >
                  {t("switchTarget", { plan: nameOf(planDroneId) })}
                </button>
              </div>
            )}
            {profileMismatch && planProfile && targetProfile && (
              <p className="text-[11px] text-status-warning" data-testid="send-profile-mismatch">
                {t("profileMismatch", { plan: describeProfile(planProfile), target: describeProfile(targetProfile) })}
              </p>
            )}
            <ul className="flex flex-col">
              {items.map((item) => {
                const row = rows[item];
                return (
                  <li key={item} className="flex flex-col gap-1 py-1.5" data-testid={`send-row-${item}`}>
                    <div className="flex items-center gap-2 min-h-7">
                      <input
                        id={`send-item-${item}`}
                        type="checkbox"
                        checked={isSelected(item)}
                        disabled={blocked[item] || running}
                        onChange={() => setDeselected((d) => ({ ...d, [item]: !d[item] }))}
                        className="accent-accent-primary w-3.5 h-3.5"
                      />
                      <label htmlFor={`send-item-${item}`} className={cn("flex-1 text-xs text-text-primary", blocked[item] && "text-text-tertiary")}>
                        {labels[item]}
                      </label>
                      {row && (
                        <span
                          data-status={row.status}
                          className={cn(
                            "inline-flex items-center gap-1 text-[11px]",
                            row.status === "running" && "text-text-tertiary",
                            row.status === "ok" && "text-status-success",
                            row.status === "failed" && "text-status-error",
                          )}
                        >
                          {row.status === "running" ? <Loader2 size={12} className="animate-spin" /> : row.status === "ok" ? <Check size={12} /> : <X size={12} />}
                          {statusLabels[row.status]}
                        </span>
                      )}
                    </div>
                    {item === "mission" && row?.status === "running" && uploadProgress && uploadProgress.total > 0 && (
                      <div className="flex flex-col gap-1 pl-6" data-testid="send-mission-progress">
                        <span className="text-[11px] text-text-secondary tabular-nums">
                          {t("progress", { sent: uploadProgress.sent, total: uploadProgress.total })}
                        </span>
                        <div
                          role="progressbar"
                          aria-label={t("progress", { sent: uploadProgress.sent, total: uploadProgress.total })}
                          aria-valuemin={0}
                          aria-valuemax={uploadProgress.total}
                          aria-valuenow={uploadProgress.sent}
                          className="h-1 bg-bg-tertiary"
                        >
                          <div
                            className="h-full bg-accent-primary transition-[width]"
                            style={{ width: `${(100 * uploadProgress.sent) / uploadProgress.total}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {flyingMission && (
                      <p className="pl-6 text-[11px] text-status-error" data-testid={`send-${item}-flying`}>
                        {t("missionInFlight")}
                      </p>
                    )}
                    {item === "geofence" && crossesFence && (
                      <p className="pl-6 text-[11px] text-status-error" data-testid="send-geofence-crossed">
                        {t("fenceCrossed")}
                      </p>
                    )}
                    {item === "mission" && errorCount > 0 && (
                      <div className="flex items-center gap-2 pl-6 text-[11px] text-status-error">
                        <span>{t("blocked", { count: errorCount })}</span>
                        <button type="button" onClick={() => openDock("issues")} className="underline cursor-pointer hover:text-text-primary focus-ring">
                          {t("reviewIssues")}
                        </button>
                      </div>
                    )}
                    {row && row.status !== "running" && row.message && (
                      <p className={cn("pl-6 text-[11px]", row.status === "failed" ? "text-status-error" : "text-text-tertiary")}>{row.message}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex items-center gap-2 pt-3 border-t border-border-default text-xs text-text-secondary">
          <span>
            {t("checklist", { done: checkedCount, total: PREFLIGHT_ITEM_IDS.length })}
          </span>
          <button type="button" onClick={() => openDock("checklist")} className="text-text-primary underline cursor-pointer hover:text-text-secondary focus-ring">
            {t("openChecklist")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
