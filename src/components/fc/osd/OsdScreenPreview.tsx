"use client";

import { useState, useCallback, useRef } from "react";
import { Monitor, Eye, Grid3x3 } from "lucide-react";
import type { OsdElement, VideoFormat } from "./ap-osd-elements";

export const FORMAT_ROWS: Record<VideoFormat, number> = { PAL: 16, NTSC: 13 };
export const GRID_COLS = 30;

interface OsdScreenPreviewProps {
  enabledElements: OsdElement[];
  activeScreen: number;
  videoFormat: VideoFormat;
  selectedDroneId: string | null;
  livePreview: boolean;
  showGrid: boolean;
  liveTelemetry: Record<string, string>;
  onShowGridChange: (show: boolean) => void;
  onLivePreviewChange: (live: boolean) => void;
  onElementMove: (id: string, row: number, col: number) => void;
}

export function OsdScreenPreview({
  enabledElements,
  activeScreen,
  videoFormat,
  selectedDroneId,
  livePreview,
  showGrid,
  liveTelemetry,
  onShowGridChange,
  onLivePreviewChange,
  onElementMove,
}: OsdScreenPreviewProps) {
  const GRID_ROWS = FORMAT_ROWS[videoFormat];
  const [dragElement, setDragElement] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleGridMouseDown = (id: string) => {
    setDragElement(id);
  };

  const handleGridMouseUp = () => {
    setDragElement(null);
  };

  const handleGridMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragElement || !gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((x / rect.width) * GRID_COLS)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((y / rect.height) * GRID_ROWS)));
      onElementMove(dragElement, row, col);
    },
    [dragElement, GRID_ROWS, onElementMove]
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary p-8">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <Monitor size={14} className="text-text-secondary" />
        <span className="text-xs font-semibold text-text-primary">OSD Preview — Screen {activeScreen}</span>
        <span className="text-[10px] text-text-tertiary">
          {enabledElements.length} elements · {videoFormat} {GRID_COLS}×{GRID_ROWS}
        </span>
        <button
          onClick={() => onShowGridChange(!showGrid)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer ${showGrid ? "text-accent-primary" : "text-text-tertiary"}`}
        >
          <Grid3x3 size={10} />
          Grid
        </button>
        <button
          onClick={() => onLivePreviewChange(!livePreview)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer ${livePreview ? "text-accent-primary" : "text-text-tertiary"}`}
        >
          <Eye size={10} />
          Live
        </button>
      </div>

      {/* Video preview area (16:9) */}
      <div
        ref={gridRef}
        className="relative bg-black border border-border-default select-none"
        style={{ width: "720px", height: "405px" }}
        onMouseMove={handleGridMouseMove}
        onMouseUp={handleGridMouseUp}
        onMouseLeave={handleGridMouseUp}
      >
        {/* Grid lines */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Vertical lines */}
            {Array.from({ length: GRID_COLS - 1 }, (_, i) => (
              <div
                key={`v${i}`}
                className="absolute top-0 bottom-0 border-l border-white/5"
                style={{ left: `${((i + 1) / GRID_COLS) * 100}%` }}
              />
            ))}
            {/* Horizontal lines */}
            {Array.from({ length: GRID_ROWS - 1 }, (_, i) => (
              <div
                key={`h${i}`}
                className="absolute left-0 right-0 border-t border-white/5"
                style={{ top: `${((i + 1) / GRID_ROWS) * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* OSD elements */}
        {enabledElements.map((el) => (
          <div
            key={el.id}
            className={`absolute font-mono text-[11px] px-1 cursor-move select-none ${
              dragElement === el.id ? "text-accent-primary bg-accent-primary/20 z-10" : "text-white/90 hover:text-accent-primary hover:bg-accent-primary/10"
            }`}
            style={{
              left: `${(el.col / GRID_COLS) * 100}%`,
              top: `${(el.row / GRID_ROWS) * 100}%`,
            }}
            onMouseDown={() => handleGridMouseDown(el.id)}
          >
            {livePreview ? (liveTelemetry[el.id] ?? el.shortLabel) : el.shortLabel}
          </div>
        ))}

        {/* Center crosshair */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="w-8 h-[1px] bg-white/20" />
          <div className="w-[1px] h-8 bg-white/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>

        {/* "NO SIGNAL" if not connected */}
        {!selectedDroneId && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-white/20 font-mono text-sm tracking-widest">OSD PREVIEW</span>
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-tertiary mt-3">
        Drag elements to reposition. Click elements in sidebar to toggle visibility.
      </p>
    </div>
  );
}
