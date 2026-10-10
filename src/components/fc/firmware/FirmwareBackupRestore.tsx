"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload, Zap } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { DroneProtocol } from "@/lib/protocol/types";
import { downloadBlob } from "@/lib/download";
import { parseParamFile, serializeParamFile, type ParsedParam } from "@/lib/formats/param-file-parser";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { ParamRestoreDialog } from "./ParamRestoreDialog";

interface FirmwareBackupRestoreProps {
  protocol: DroneProtocol | null;
  selectedDroneId: string | null;
  /** Name of the connected vehicle, shown in the restore confirmation. */
  targetLabel: string;
  isFlashing: boolean;
  allChecked: boolean;
  serialSupported: boolean;
  usbSupported: boolean;
  onFlash: () => void;
  /** Why flashing is refused right now (armed, or not on a local USB link), or null. */
  blockedReason: string | null;
  onMessage: (msg: string) => void;
  onParamBackupChecked: () => void;
}

export function FirmwareBackupRestore({
  protocol,
  selectedDroneId,
  targetLabel,
  isFlashing,
  allChecked,
  serialSupported,
  usbSupported,
  onFlash,
  blockedReason,
  onMessage,
  onParamBackupChecked,
}: FirmwareBackupRestoreProps) {
  const { toast } = useToast();
  const t = useTranslations("fcToasts.firmware");
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [restore, setRestore] = useState<{ fileName: string; entries: ParsedParam[] } | null>(null);

  const handleBackupParams = useCallback(async () => {
    if (!protocol) return;

    onMessage("Downloading parameters...");
    try {
      const params = await protocol.getAllParameters();
      const text = serializeParamFile(
        params.map((p) => ({ name: p.name, value: p.value, type: p.type })),
        { format: "mp" },
      );
      const blob = new Blob([text], { type: "text/plain" });
      downloadBlob(blob, `params-backup-${Date.now()}.param`);
      onMessage(`Backed up ${params.length} parameters`);
      onParamBackupChecked();
      toast(t("backupDone", { count: params.length }), "success");
    } catch (err) {
      onMessage(`Backup failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      toast(t("backupFailed"), "error");
    }
  }, [protocol, toast, t, onMessage, onParamBackupChecked]);

  // Pick a file, then review the diff in the dialog; nothing is written here.
  const handleRestoreParams = useCallback(() => {
    if (isHardBlocked) {
      toast(hardBlockMessage, "error");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".param,.params,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Mission Planner (NAME,VALUE / NAME VALUE) and QGC
      // (SYSID COMPID NAME VALUE TYPE) files both parse here.
      const entries = parseParamFile(await file.text());
      if (entries.length === 0) {
        toast(t("restoreNoParams"), "error");
        return;
      }
      setRestore({ fileName: file.name, entries });
    };
    input.click();
  }, [isHardBlocked, hardBlockMessage, toast, t]);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onFlash}
        disabled={!allChecked || isFlashing || blockedReason !== null || (!serialSupported && !usbSupported)}
        title={blockedReason ?? undefined}
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-accent-primary text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-accent-primary/80 transition-colors"
      >
        <Zap size={14} />
        {isFlashing ? "Flashing..." : "Flash Firmware"}
      </button>

      <button
        onClick={handleBackupParams}
        disabled={!selectedDroneId || isFlashing}
        className="flex items-center gap-2 px-4 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <Download size={14} />
        Backup Parameters
      </button>

      <button
        onClick={handleRestoreParams}
        disabled={!selectedDroneId || isFlashing || isHardBlocked}
        title={isHardBlocked ? hardBlockMessage : undefined}
        className="flex items-center gap-2 px-4 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <Upload size={14} />
        Restore Parameters
      </button>

      <ParamRestoreDialog
        open={restore !== null}
        sourceLabel={restore?.fileName ?? ""}
        targetLabel={targetLabel}
        entries={restore?.entries ?? []}
        protocol={protocol}
        onClose={() => setRestore(null)}
        onApplied={() => onMessage("Parameters restored")}
      />
    </div>
  );
}
