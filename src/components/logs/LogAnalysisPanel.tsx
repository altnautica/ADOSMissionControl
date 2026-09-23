"use client";

/**
 * @module LogAnalysisPanel
 * @description Composite panel that combines quick telemetry graphs, GPS track
 * map, planned vs actual path comparison, and external analysis links.
 * @license GPL-3.0-only
 */

import { useState, useCallback, useRef } from "react";
import { BarChart3, Upload } from "lucide-react";
import { QuickGraphs } from "./QuickGraphs";
import { ExternalLogLinks } from "./ExternalLogLinks";
import { parseDataFlashLogStreaming } from "@/lib/dataflash-streaming";
import type { DataFlashLog } from "@/lib/dataflash-parser";
import dynamic from "next/dynamic";

const GpsTrackMap = dynamic(
  () => import("./GpsTrackMap").then((m) => ({ default: m.GpsTrackMap })),
  { ssr: false }
);

type LogTab = "live" | "file";

export function LogAnalysisPanel() {
  const [tab, setTab] = useState<LogTab>("live");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parsedLog, setParsedLog] = useState<DataFlashLog | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setParseProgress(0);
    setParseError(null);
    setParsedLog(null);

    try {
      const buffer = await file.arrayBuffer();
      const log = await parseDataFlashLogStreaming(buffer, {
        onProgress: setParseProgress,
        chunkSize: 2 * 1024 * 1024, // 2MB chunks
      });
      setParsedLog(log);
      setTab("file");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse log file");
    } finally {
      setParsing(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <BarChart3 size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          Log Analysis
        </span>

        <div className="flex-1" />

        {/* Tab toggle */}
        <div className="flex items-center gap-0.5 bg-bg-tertiary p-0.5 rounded">
          <button
            onClick={() => setTab("live")}
            className={`px-2 py-1 text-[10px] cursor-pointer rounded transition-colors ${
              tab === "live"
                ? "bg-bg-secondary text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setTab("file")}
            className={`px-2 py-1 text-[10px] cursor-pointer rounded transition-colors ${
              tab === "file"
                ? "bg-bg-secondary text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            File
          </button>
        </div>

        {/* File upload */}
        <label className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer border border-border-default rounded hover:border-accent-primary transition-colors">
          <Upload size={10} />
          {parsing ? `${(parseProgress * 100).toFixed(0)}%` : "Load .bin"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".bin,.BIN"
            className="hidden"
            onChange={handleFileUpload}
            disabled={parsing}
          />
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === "live" && (
          <>
            <QuickGraphs />
            <GpsTrackMap />
            <ExternalLogLinks />
          </>
        )}
        {tab === "file" && (
          <>
            {parseError && (
              <div className="border border-status-error bg-status-error/10 p-3 text-[11px] text-status-error font-mono rounded">
                {parseError}
              </div>
            )}
            {parsedLog && (
              <div className="space-y-3">
                <div className="border border-border-default bg-bg-secondary p-3">
                  <span className="text-xs font-semibold text-text-primary">
                    Parsed Log
                  </span>
                  <div className="mt-2 text-[10px] font-mono text-text-secondary space-y-1">
                    <div>
                      Message types:{" "}
                      {Array.from(parsedLog.messages.keys()).length}
                    </div>
                    <div>
                      Total messages:{" "}
                      {Array.from(parsedLog.messages.values()).reduce(
                        (sum, arr) => sum + arr.length,
                        0
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {Array.from(parsedLog.messages.keys())
                        .sort()
                        .map((name) => (
                          <span
                            key={name}
                            className="px-1.5 py-0.5 bg-bg-tertiary border border-border-default text-[9px] rounded"
                          >
                            {name} ({parsedLog.messages.get(name)?.length})
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
                <ExternalLogLinks />
              </div>
            )}
            {!parsedLog && !parseError && (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <Upload size={24} className="mb-2" />
                <span className="text-xs">
                  Load a .bin DataFlash log to analyze
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
