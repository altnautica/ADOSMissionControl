"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Clock, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, isDemoMode } from "@/lib/utils";
import type { LogMetadata } from "@/lib/analysis/types";

interface PidLogUploaderProps {
  onFileSelect: (file: File) => void;
  /** Loads the bundled sample analysis. Offered in demo mode only. */
  onLoadSample: () => void;
  analyzing: boolean;
  progress: { stage: string; percent: number } | null;
  metadata: LogMetadata | null;
}

/** Spinner, stage name and percentage while a log is being analysed. */
export function AnalysisProgress({ progress }: { progress: { stage: string; percent: number } }) {
  return (
    <div className="border border-border-default bg-bg-secondary p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-medium text-text-primary">{progress.stage}</span>
        <div className="w-full max-w-xs">
          <div className="h-1.5 bg-bg-tertiary w-full">
            <div
              className="h-full bg-accent-primary transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-text-tertiary mt-1 block text-center">
            {Math.round(progress.percent)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function PidLogUploader({
  onFileSelect,
  onLoadSample,
  analyzing,
  progress,
  metadata,
}: PidLogUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [onFileSelect],
  );

  // Progress state
  if (analyzing && progress) {
    return <AnalysisProgress progress={progress} />;
  }

  // Metadata summary after analysis
  if (metadata) {
    return (
      <div className="border border-border-default bg-bg-secondary p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={14} className="text-accent-primary" />
          <span className="text-xs font-medium text-text-primary">Log Loaded</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-tertiary/50 p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={10} className="text-text-tertiary" />
              <span className="text-[9px] text-text-tertiary uppercase">Duration</span>
            </div>
            <span className="text-xs font-mono text-text-primary">{formatDuration(metadata.durationSec)}</span>
          </div>
          <div className="bg-bg-tertiary/50 p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <HardDrive size={10} className="text-text-tertiary" />
              <span className="text-[9px] text-text-tertiary uppercase">Size</span>
            </div>
            <span className="text-xs font-mono text-text-primary">{formatBytes(metadata.fileSizeBytes)}</span>
          </div>
          <div className="bg-bg-tertiary/50 p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] text-text-tertiary">Hz</span>
              <span className="text-[9px] text-text-tertiary uppercase">Gyro Rate</span>
            </div>
            <span className="text-xs font-mono text-text-primary">{metadata.gyroSampleRate} Hz</span>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 text-[10px] text-accent-primary hover:underline cursor-pointer"
        >
          Upload a different log
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".bin"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    );
  }

  // Default upload state
  return (
    <div
      className={cn(
        "border-2 border-dashed bg-bg-secondary p-8 transition-colors",
        dragOver ? "border-accent-primary bg-accent-primary/5" : "border-border-default",
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="flex flex-col items-center gap-3">
        <Upload
          size={28}
          className={cn(
            "transition-colors",
            dragOver ? "text-accent-primary" : "text-text-tertiary",
          )}
        />
        <div className="text-center">
          <p className="text-sm text-text-secondary">Drop .bin log file here</p>
          <p className="text-[10px] text-text-tertiary mt-1">
            ArduPilot DataFlash binary log
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload size={12} />}
            onClick={() => fileInputRef.current?.click()}
          >
            Browse Files
          </Button>
          {isDemoMode() && (
            <button
              onClick={onLoadSample}
              className="text-[10px] text-accent-primary hover:underline cursor-pointer"
            >
              Load Sample Log
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".bin"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
