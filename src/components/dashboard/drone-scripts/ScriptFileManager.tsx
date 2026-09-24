"use client";

/**
 * @module drone-scripts/ScriptFileManager
 * @description The APM/scripts/ file manager for the ArduPilot Scripts tab:
 * lists the FC's onboard `.lua` scripts over MAVLink FTP, uploads a new script
 * (drag-drop / picker, with a live progress bar), downloads a script back, and
 * deletes one behind a confirm. FTP runs over the selected drone's transport,
 * so this works direct-to-FC and via the agent's transparent MAVLink pipe.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileCode2,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import type { FtpDirEntry } from "@/lib/protocol/types/protocol";
import {
  SCRIPTS_DIR,
  SCRIPT_EXTENSION,
  MAX_SCRIPT_BYTES,
} from "./scripts-constants";
import { downloadBlob } from "@/lib/download";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ScriptFileManager({
  onUploaded,
  reloadSignal,
}: {
  onUploaded?: () => void;
  /** Bump this to force a re-list (e.g. after an applet is added elsewhere). */
  reloadSignal?: number;
}) {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();

  const [entries, setEntries] = useState<FtpDirEntry[]>([]);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FtpDirEntry | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.listDirectoryViaFtp) {
      setError("This connection does not support file transfer.");
      return;
    }
    setListing(true);
    setError(null);
    try {
      const list = await protocol.listDirectoryViaFtp(SCRIPTS_DIR);
      // Only `.lua` files, directories filtered out — the scripts dir is flat.
      setEntries(
        list
          .filter((e) => !e.isDir && e.name.toLowerCase().endsWith(SCRIPT_EXTENSION))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      // A missing APM/scripts dir NAKs FileNotFound — treat as "no scripts yet".
      const msg = err instanceof Error ? err.message : String(err);
      if (/FileNotFound|NoSuchFile|EndOfFile/i.test(msg)) {
        setEntries([]);
      } else {
        setError(msg);
      }
    } finally {
      setListing(false);
    }
  }, [selectedProtocol]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadSignal]);

  const doUpload = useCallback(
    async (file: File) => {
      const protocol = selectedProtocol;
      if (!protocol?.uploadFileViaFtp) {
        toast("This connection does not support file upload.", "error");
        return;
      }
      if (!file.name.toLowerCase().endsWith(SCRIPT_EXTENSION)) {
        toast("Only .lua scripts can be uploaded.", "error");
        return;
      }
      if (file.size > MAX_SCRIPT_BYTES) {
        toast(`Script is too large (max ${formatSize(MAX_SCRIPT_BYTES)}).`, "error");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      setUpload({ name: file.name, pct: 0 });
      try {
        await protocol.uploadFileViaFtp(
          `${SCRIPTS_DIR}/${file.name}`,
          bytes,
          (written, total) =>
            setUpload({ name: file.name, pct: total ? (written / total) * 100 : 100 }),
        );
        toast(`Uploaded ${file.name} — reboot the FC to run it.`, "success");
        onUploaded?.();
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Upload failed: ${msg}`, "error");
      } finally {
        setUpload(null);
      }
    },
    [selectedProtocol, toast, onUploaded, refresh],
  );

  async function doDownload(entry: FtpDirEntry) {
    const protocol = selectedProtocol;
    if (!protocol?.downloadFileViaFtp) return;
    try {
      const bytes = await protocol.downloadFileViaFtp(`${SCRIPTS_DIR}/${entry.name}`);
      const blob = new Blob([bytes as BlobPart], { type: "text/x-lua" });
      downloadBlob(blob, entry.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Download failed: ${msg}`, "error");
    }
  }

  async function confirmDelete() {
    const entry = deleteTarget;
    setDeleteTarget(null);
    if (!entry) return;
    const protocol = selectedProtocol;
    if (!protocol?.removeFileViaFtp) return;
    try {
      await protocol.removeFileViaFtp(`${SCRIPTS_DIR}/${entry.name}`);
      toast(`Deleted ${entry.name}`, "warning");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Delete failed: ${msg}`, "error");
    }
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">
            Scripts on FC
          </h2>
          <span className="text-[10px] font-mono text-text-tertiary">
            {SCRIPTS_DIR}/
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={12} className={listing ? "animate-spin" : ""} />}
          onClick={refresh}
          disabled={listing}
        >
          Refresh
        </Button>
      </div>

      {/* Upload drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void doUpload(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded border border-dashed border-border-default py-4 cursor-pointer transition-colors",
          dragOver ? "border-accent-primary bg-accent-primary/5" : "hover:border-text-tertiary",
        )}
      >
        <Upload size={16} className="text-text-tertiary" />
        <span className="text-[11px] text-text-secondary">
          Drop a <span className="font-mono">.lua</span> script here, or click to
          browse
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".lua"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void doUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {upload && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-text-secondary">
            <span className="font-mono truncate">{upload.name}</span>
            <span className="tabular-nums">{Math.round(upload.pct)}%</span>
          </div>
          <ProgressBar value={upload.pct} />
        </div>
      )}

      {error && (
        <p className="text-[11px] text-status-error">{error}</p>
      )}

      {/* File list */}
      {entries.length === 0 && !listing && !error ? (
        <p className="py-3 text-center text-[11px] text-text-tertiary">
          No scripts on the flight controller yet.
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {entries.map((entry) => (
            <li key={entry.name} className="flex items-center gap-2 py-2">
              <FileCode2 size={13} className="text-text-tertiary shrink-0" />
              <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text-primary">
                {entry.name}
              </span>
              <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
                {formatSize(entry.size)}
              </span>
              <button
                type="button"
                title="Download"
                onClick={() => doDownload(entry)}
                className="p-1 text-text-tertiary hover:text-accent-primary cursor-pointer"
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => setDeleteTarget(entry)}
                className="p-1 text-text-tertiary hover:text-status-error cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete script"
        message={`Delete ${deleteTarget?.name ?? ""} from the flight controller? This cannot be undone. The script stops running after the next reboot.`}
        variant="danger"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
