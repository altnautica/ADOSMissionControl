"use client";

import { useCallback, useState } from "react";
import { Download, Upload, HardDrive, Zap } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { DroneProtocol } from "@/lib/protocol/types";
import { downloadBlob } from "@/lib/download";

interface FirmwareBackupRestoreProps {
  protocol: DroneProtocol | null;
  selectedDroneId: string | null;
  isFlashing: boolean;
  allChecked: boolean;
  serialSupported: boolean;
  usbSupported: boolean;
  onFlash: () => void;
  onMessage: (msg: string) => void;
  onParamBackupChecked: () => void;
}

export function FirmwareBackupRestore({
  protocol,
  selectedDroneId,
  isFlashing,
  allChecked,
  serialSupported,
  usbSupported,
  onFlash,
  onMessage,
  onParamBackupChecked,
}: FirmwareBackupRestoreProps) {
  const { toast } = useToast();
  const [showCommitButton, setShowCommitButton] = useState(false);

  const handleBackupParams = useCallback(async () => {
    if (!protocol) return;

    onMessage("Downloading parameters...");
    try {
      const params = await protocol.getAllParameters();
      const lines = params.map((p) => `${p.name}\t${p.value}`);
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      downloadBlob(blob, `params-backup-${Date.now()}.param`);
      onMessage(`Backed up ${params.length} parameters`);
      onParamBackupChecked();
      toast(`Backed up ${params.length} parameters`, "success");
    } catch (err) {
      onMessage(`Backup failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      toast("Parameter backup failed", "error");
    }
  }, [protocol, toast, onMessage, onParamBackupChecked]);

  const handleRestoreParams = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".param,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!protocol) {
        onMessage("Connect a drone first");
        return;
      }

      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      onMessage(`Restoring ${lines.length} parameters...`);

      let success = 0;
      let failed = 0;
      for (const line of lines) {
        const [name, valueStr] = line.split(/\s+/);
        if (!name || !valueStr) continue;
        const value = parseFloat(valueStr);
        if (isNaN(value)) continue;

        try {
          const result = await protocol.setParameter(name, value);
          if (result.success) success++;
          else failed++;
        } catch {
          failed++;
        }
      }

      onMessage(`Restored ${success} parameters (${failed} failed)`);
      if (success > 0) {
        setShowCommitButton(true);
        toast(`Restored ${success} parameters`, "success");
      }
      if (failed > 0) {
        toast(`${failed} parameters failed to restore`, "warning");
      }
    };
    input.click();
  }, [protocol, toast, onMessage]);

  const commitToFlash = useCallback(async () => {
    if (!protocol) return;
    try {
      const result = await protocol.commitParamsToFlash();
      if (result.success) {
        setShowCommitButton(false);
        toast("Written to flash — persists after reboot", "success");
      } else {
        toast("Failed to write to flash", "error");
      }
    } catch {
      toast("Failed to write to flash", "error");
    }
  }, [protocol, toast]);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onFlash}
        disabled={!allChecked || isFlashing || (!serialSupported && !usbSupported)}
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-accent-primary text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-accent-primary/80 transition-colors"
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
        disabled={!selectedDroneId || isFlashing}
        className="flex items-center gap-2 px-4 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <Upload size={14} />
        Restore Parameters
      </button>

      {showCommitButton && (
        <button
          onClick={commitToFlash}
          className="flex items-center gap-2 px-4 py-2 text-xs border border-accent-primary/50 text-accent-primary hover:bg-accent-primary/10 cursor-pointer transition-colors"
        >
          <HardDrive size={14} />
          Write to Flash
        </button>
      )}
    </div>
  );
}
