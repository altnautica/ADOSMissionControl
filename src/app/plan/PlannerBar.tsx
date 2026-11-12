/**
 * @module PlannerBar
 * @description Top bar of the active planner: plan identity (library toggle,
 * inline name, unsaved dot), vehicle assignment, issue count, Save, the single
 * primary "Upload to vehicle" action and the plan overflow menu.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, ArrowDownUp, Copy, Download, FileDown, FileOutput, FileSpreadsheet, FileText,
  FileUp, Globe, Library, Link2, MoreHorizontal, Move, Plane, Play, Save, Trash2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePlannerValidation } from "@/hooks/use-planner-validation";
import { useMissionUploadStatus } from "@/hooks/use-upload-status";
import { buildFenceElements } from "@/lib/geofence-elements";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useVehicleOptions } from "./use-vehicle-options";
import { flyThisMission } from "@/components/planner/fly-this-mission";
import { useDescribeUploadFailure } from "@/components/planner/use-describe-upload-failure";
import { PlannerViewToggle } from "./PlannerViewToggle";
import type { PlannerShareImport } from "./use-planner-share-import";
import type { Planner } from "./use-planner";

/** What the upload dialog would offer for the current plan. */
export interface Sendable {
  hasWaypoints: boolean;
  fenceSendable: boolean;
  rallySendable: boolean;
  canSendSomething: boolean;
}

/**
 * Whether the plan has anything to send: the mission, a fence (when the
 * vehicle supports one) or rally points. Mirrors the Send dialog's row
 * availability so the bar, the palette and the dialog agree.
 */
export function useSendable(p: Planner, showGeofence: boolean, showRally: boolean): Sendable {
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
  const hasWaypoints = p.waypoints.length > 0;
  const fenceSendable = showGeofence && fenceHasGeometry;
  const rallySendable = showRally && rallyCount > 0;
  return { hasWaypoints, fenceSendable, rallySendable, canSendSomething: hasWaypoints || fenceSendable || rallySendable };
}

interface PlannerBarProps {
  p: Planner;
  hasDrone: boolean;
  showGeofence: boolean;
  showRally: boolean;
  shareIo: PlannerShareImport;
  onOpenSend: () => void;
}

export function PlannerBar({ p, hasDrone, showGeofence, showRally, shareIo, onOpenSend }: PlannerBarProps) {
  const t = useTranslations("planner");
  const router = useRouter();
  const librarySheetOpen = usePlannerStore((s) => s.librarySheetOpen);
  const setLibrarySheetOpen = usePlannerStore((s) => s.setLibrarySheetOpen);
  const setDock = usePlannerStore((s) => s.setDock);
  const vehicleOptions = useVehicleOptions(p.drones, p.selectedDroneId);
  // Picking a connected vehicle for the plan also makes it the upload target
  // when no drone is selected yet; a drone already selected elsewhere stays
  // selected, and the upload dialog offers the switch.
  const handleVehicleChange = (id: string) => {
    p.setSelectedDroneId(id);
    const manager = useDroneManager.getState();
    if (id && manager.selectedDroneId === null && manager.drones.has(id)) manager.selectDrone(id);
  };

  // Hard errors (out-of-fence, below terrain, bad jump target, ...) block the
  // send so an invalid mission can't be pushed to the FC.
  // The map's terrain-clash legs read the same shared result.
  const errorCount = usePlannerValidation(p.waypoints)?.errors.length ?? 0;

  const { hasWaypoints, fenceSendable, rallySendable, canSendSomething } = useSendable(p, showGeofence, showRally);
  const isDownloading = p.downloadState === "downloading";

  // Honest upload-state cue, from the upload receipt: "sent" only when the
  // selected drone acknowledged exactly the mission the planner would upload
  // now; an edit, a plan switch or another drone reads differently.
  const status = useMissionUploadStatus();
  const uploadError = useMissionStore((s) => s.uploadError);
  const uploadErrorCode = useMissionStore((s) => s.uploadErrorCode);
  const uploadProgress = useMissionStore((s) => s.uploadProgress);
  const uploadFailure = useDescribeUploadFailure()(uploadErrorCode, uploadError);
  const targetDroneId = useDroneManager((s) => s.selectedDroneId);
  const sending = p.uploadState === "uploading";
  const sendLabel = errorCount > 0
    ? t("bar.fixIssues", { count: errorCount })
    : sending
      ? uploadProgress && uploadProgress.total > 0
        ? t("bar.sendingProgress", { sent: uploadProgress.sent, total: uploadProgress.total })
        : t("bar.sending")
      : status === "on-aircraft"
        ? t("bar.sent")
        : t("bar.send");
  const sendTitle = errorCount > 0
    ? t("uploadBlockedErrors", { count: errorCount })
    : !hasDrone
      ? t("bar.noVehicle")
      : !canSendSomething
        ? t("bar.emptyMission")
        : undefined;
  // With mission errors and nothing else to send, the button leads to the
  // issues; otherwise the dialog opens and blocks only the mission row.
  const handleSendClick = () => {
    if (errorCount > 0 && !fenceSendable && !rallySendable) setDock("issues", true);
    else onOpenSend();
  };
  const statusChip =
    p.uploadState === "error"
      ? {
          label: t("uploadFailed"),
          title: uploadFailure ? `${t("uploadFailed")}: ${uploadFailure}` : t("uploadFailed"),
          className: "text-status-error",
        }
      : status === "older-on-aircraft"
        ? { label: t("olderMissionOnAircraft"), title: t("olderMissionOnAircraft"), className: "text-status-warning" }
        : null;

  const overflowItems = [
    // The plan is on the drone: the next step is flying it.
    ...(status === "on-aircraft" && targetDroneId
      ? [{ id: "fly-mission", label: t("send.flyMission"), icon: <Plane size={12} /> }, { id: "div0", label: "", divider: true }]
      : []),
    { id: "download-drone", label: isDownloading ? t("loading") : t("bar.downloadFromDrone"), icon: <Download size={12} />, disabled: isDownloading || !hasDrone },
    { id: "import-boundary", label: t("import.boundary.menuLabel"), icon: <FileUp size={12} /> },
    { id: "div1", label: "", divider: true },
    { id: "export-native", label: t("bar.exportNative"), icon: <FileDown size={12} /> },
    { id: "export-waypoints", label: t("exportWaypoints"), icon: <FileDown size={12} /> },
    { id: "export-plan", label: t("exportPlanQgc"), icon: <FileOutput size={12} /> },
    { id: "export-kml", label: t("exportKml"), icon: <Globe size={12} /> },
    { id: "export-kmz", label: t("bar.exportKmz"), icon: <Globe size={12} /> },
    { id: "export-csv", label: t("exportCsv"), icon: <FileSpreadsheet size={12} /> },
    { id: "export-brief", label: t("export.brief.menuLabel"), icon: <FileText size={12} />, disabled: !hasWaypoints },
    { id: "share-link", label: t("share.copyLink"), icon: <Link2 size={12} />, disabled: !hasWaypoints },
    { id: "save-as", label: t("bar.saveAs"), icon: <Copy size={12} /> },
    { id: "div2", label: "", divider: true },
    { id: "reverse", label: t("bar.reverse"), icon: <ArrowDownUp size={12} /> },
    { id: "transform", label: t("bar.transform"), icon: <Move size={12} /> },
    { id: "simulate", label: t("bar.simulate"), icon: <Play size={12} />, disabled: !hasWaypoints },
    { id: "div3", label: "", divider: true },
    { id: "discard", label: t("bar.discard"), icon: <Trash2 size={12} />, danger: true },
  ];

  const handleOverflow = (id: string) => {
    if (id === "fly-mission") { if (targetDroneId) flyThisMission(targetDroneId, (href) => router.push(href)); }
    else if (id === "download-drone") p.handleDownloadFromDrone();
    else if (id === "import-boundary") shareIo.handleImportBoundary();
    else if (id === "export-native") p.handleExportNative();
    else if (id === "export-waypoints") p.handleExportWaypoints();
    else if (id === "export-plan") p.handleExportPlan();
    else if (id === "export-kml") p.handleExportKML();
    else if (id === "export-kmz") p.handleExportKMZ();
    else if (id === "export-csv") p.handleExportCSV();
    else if (id === "export-brief") shareIo.handleExportBrief();
    else if (id === "share-link") void shareIo.handleCopyShareLink();
    else if (id === "save-as") p.handleSaveAs();
    else if (id === "reverse") p.handleReverseWaypoints();
    else if (id === "transform") {
      const store = usePlannerStore.getState();
      store.setInspectorTarget({ kind: "transform" });
      if (!store.inspectorOpen) store.toggleInspector();
    } else if (id === "simulate") router.push("/simulate");
    else if (id === "discard") p.handleClearAll();
  };

  return (
    <div className="h-10 shrink-0 flex items-center gap-2 px-2 border-b border-border-default bg-bg-secondary">
      <Button
        variant="ghost"
        size="sm"
        icon={<Library size={14} />}
        aria-pressed={librarySheetOpen}
        title={t("bar.plansTitle")}
        className={cn(librarySheetOpen && "text-accent-primary")}
        onClick={() => setLibrarySheetOpen(!librarySheetOpen)}
      >
        {t("bar.plans")}
      </Button>
      <PlanNameField name={p.missionName} onCommit={p.setMissionName} />
      {p.isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-status-warning shrink-0"
          role="status"
          aria-label={t("unsavedChanges")}
          title={t("unsavedChanges")}
        />
      )}

      <div className="flex-1" />

      <div className="w-48 shrink-0" title={t("bar.vehicle")}>
        <Select options={vehicleOptions} value={p.selectedDroneId} onChange={handleVehicleChange} ariaLabel={t("bar.vehicle")} className="h-7 text-xs" />
      </div>
      {errorCount > 0 && (
        <button
          type="button"
          onClick={() => setDock("issues", true)}
          title={t("bar.issuesTitle")}
          aria-label={t("bar.issues", { count: errorCount })}
          className="h-7 inline-flex items-center gap-1 px-2 text-xs text-status-error hover:bg-bg-tertiary cursor-pointer focus-ring transition-colors"
        >
          <AlertTriangle size={12} />
          <span className="font-mono">{errorCount}</span>
        </button>
      )}
      {statusChip && (
        <span className={cn("text-[11px] truncate max-w-40", statusChip.className)} title={statusChip.title}>
          {statusChip.label}
        </span>
      )}
      <Button variant="secondary" size="sm" icon={<Save size={14} />} disabled={!p.isDirty} onClick={p.handleSave}>
        {t("bar.save")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        icon={<Upload size={14} />}
        disabled={!hasDrone || !canSendSomething}
        loading={sending}
        title={sendTitle}
        onClick={handleSendClick}
      >
        {sendLabel}
      </Button>
      <PlannerViewToggle />
      <DropdownMenu
        trigger={<Button variant="ghost" size="sm" icon={<MoreHorizontal size={14} />} aria-label={t("bar.more")} title={t("bar.more")} />}
        items={overflowItems}
        onSelect={handleOverflow}
        align="right"
      />
    </div>
  );
}

/** Inline plan name: edits a draft, commits on blur or Enter, Esc reverts. */
function PlanNameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const t = useTranslations("planner");
  const [draft, setDraft] = useState(name);
  const [syncedName, setSyncedName] = useState(name);
  const revertRef = useRef(false);
  // Follow external renames (library rename, plan switch) while not editing.
  if (syncedName !== name) {
    setSyncedName(name);
    setDraft(name);
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      revertRef.current = true;
      setDraft(name);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label={t("bar.nameLabel")}
      placeholder={t("untitledMission")}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (revertRef.current) {
          revertRef.current = false;
          return;
        }
        if (draft === name) return;
        // Save skips an empty name, so an empty draft would leave the plan
        // permanently dirty; revert it instead.
        if (!draft.trim()) {
          setDraft(name);
          return;
        }
        onCommit(draft);
      }}
      title={draft}
      className="h-7 min-w-0 basis-56 grow max-w-96 px-1.5 bg-transparent border border-transparent text-sm font-medium text-text-primary text-ellipsis placeholder:text-text-tertiary hover:border-border-default focus:border-accent-primary focus:outline-none focus-ring transition-colors"
    />
  );
}
