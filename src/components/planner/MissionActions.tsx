/**
 * @module MissionActions
 * @description Action bar at the bottom of the planner right panel.
 * Upload to drone (primary) and overflow menu with export, save-as,
 * reverse waypoints, and discard changes.
 * @license GPL-3.0-only
 */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload, Save, MoreHorizontal, Download, FileDown, FileOutput, FileSpreadsheet, Globe, Copy, ArrowDownUp, Trash2, Play, FileUp, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useMissionUploadStatus } from "@/hooks/use-upload-status";

interface MissionActionsProps {
  hasWaypoints: boolean;
  hasDrone: boolean;
  /** Count of blocking validation errors — upload is disabled while > 0. */
  validationErrors?: number;
  uploadState: "idle" | "uploading" | "uploaded" | "error";
  downloadState: "idle" | "downloading" | "downloaded" | "error";
  isDirty: boolean;
  onSave: () => void;
  onUpload: () => void;
  onDownloadFromDrone: () => void;
  onExportWaypoints: () => void;
  onExportPlan: () => void;
  onExportKML: () => void;
  onExportCSV: () => void;
  onExportKMZ: () => void;
  onExportNative: () => void;
  onExportBrief: () => void;
  onCopyShareLink: () => void;
  onImportBoundary: () => void;
  onSaveAs: () => void;
  onReverseWaypoints: () => void;
  onDiscard: () => void;
}

export function MissionActions({
  hasWaypoints,
  hasDrone,
  validationErrors = 0,
  uploadState,
  downloadState,
  isDirty,
  onSave,
  onUpload,
  onDownloadFromDrone,
  onExportWaypoints,
  onExportPlan,
  onExportKML,
  onExportCSV,
  onExportKMZ,
  onExportNative,
  onExportBrief,
  onCopyShareLink,
  onImportBoundary,
  onSaveAs,
  onReverseWaypoints,
  onDiscard,
}: MissionActionsProps) {
  const router = useRouter();
  const t = useTranslations("planner");

  const isDownloading = downloadState === "downloading";
  const overflowItems = [
    { id: "download-drone", label: isDownloading ? t("loading") : t("downloadFromDrone"), icon: <Download size={12} />, disabled: isDownloading || !hasDrone },
    { id: "import-boundary", label: t("import.boundary.menuLabel"), icon: <FileUp size={12} /> },
    { id: "div1", label: "", divider: true },
    { id: "export-native", label: "Export (.altmission, lossless)", icon: <FileDown size={12} /> },
    { id: "export-waypoints", label: t("exportWaypoints"), icon: <FileDown size={12} /> },
    { id: "export-plan", label: t("exportPlanQgc"), icon: <FileOutput size={12} /> },
    { id: "export-kml", label: t("exportKml"), icon: <Globe size={12} /> },
    { id: "export-kmz", label: "Export (.kmz)", icon: <Globe size={12} /> },
    { id: "export-csv", label: t("exportCsv"), icon: <FileSpreadsheet size={12} /> },
    { id: "export-brief", label: t("export.brief.menuLabel"), icon: <FileText size={12} />, disabled: !hasWaypoints },
    { id: "share-link", label: t("share.copyLink"), icon: <Link2 size={12} />, disabled: !hasWaypoints },
    { id: "save-as", label: t("saveAsNewPlan"), icon: <Copy size={12} /> },
    { id: "div2", label: "", divider: true },
    { id: "reverse", label: t("reverseWaypoints"), icon: <ArrowDownUp size={12} /> },
    { id: "div3", label: "", divider: true },
    { id: "discard", label: t("discardChanges"), icon: <Trash2 size={12} />, danger: true },
  ];

  const handleOverflow = (id: string) => {
    if (id === "download-drone") onDownloadFromDrone();
    else if (id === "import-boundary") onImportBoundary();
    else if (id === "export-native") onExportNative();
    else if (id === "export-brief") onExportBrief();
    else if (id === "share-link") onCopyShareLink();
    else if (id === "export-waypoints") onExportWaypoints();
    else if (id === "export-plan") onExportPlan();
    else if (id === "export-kml") onExportKML();
    else if (id === "export-kmz") onExportKMZ();
    else if (id === "export-csv") onExportCSV();
    else if (id === "save-as") onSaveAs();
    else if (id === "reverse") onReverseWaypoints();
    else if (id === "discard") onDiscard();
  };

  // Honest upload-state cue, from the upload receipt: "on aircraft" only when
  // the selected drone acknowledged exactly the mission the planner would
  // upload now; an edit, a plan switch or another drone reads differently.
  const status = useMissionUploadStatus();
  const uploadPill =
    uploadState === "error"
      ? { label: t("uploadFailed"), className: "text-status-error border-status-error/40 bg-status-error/10" }
      : status === "on-aircraft"
        ? { label: t("onAircraft"), className: "text-status-success border-status-success/40 bg-status-success/10" }
        : status === "older-on-aircraft"
          ? { label: t("olderMissionOnAircraft"), className: "text-status-warning border-status-warning/40 bg-status-warning/10" }
          : null;

  return (
    <div className="border-t border-border-default p-3 flex flex-col gap-2">
      {uploadPill && (
        <div className={cn("flex items-center gap-1.5 self-start text-[10px] font-mono px-2 py-0.5 rounded border", uploadPill.className)}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {uploadPill.label}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="lg"
          icon={<Save size={14} />}
          disabled={!isDirty}
          onClick={onSave}
        >
          {t("saveMission")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          icon={<Upload size={14} />}
          disabled={!hasWaypoints || !hasDrone || validationErrors > 0}
          loading={uploadState === "uploading"}
          onClick={onUpload}
          title={validationErrors > 0 ? t("uploadBlockedErrors", { count: validationErrors }) : undefined}
        >
          {validationErrors > 0 ? t("uploadErrors", { count: validationErrors }) : t("uploadToFc")}
        </Button>
        <DropdownMenu
          trigger={
            <Button variant="ghost" size="md" icon={<MoreHorizontal size={14} />} />
          }
          items={overflowItems}
          onSelect={handleOverflow}
          align="right"
        />
      </div>
      <Button
        variant="ghost"
        size="md"
        className="w-full"
        icon={<Play size={14} />}
        disabled={!hasWaypoints}
        onClick={() => router.push("/simulate")}
      >
        {t("simulateIn3d")}
      </Button>
    </div>
  );
}
