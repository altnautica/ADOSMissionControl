/**
 * @module OverlayPanel
 * @description Slide-out panel for managing KML/KMZ overlay files.
 * Upload, toggle visibility, adjust opacity, and remove overlays.
 * @license GPL-3.0-only
 */
"use client";

import { useRef, useCallback } from "react";
import { useOverlayStore, type KmlOverlay } from "@/stores/overlay-store";
import { parseKML } from "@/lib/formats/kml-parser";
import { X, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { randomId } from "@/lib/utils";

interface OverlayPanelProps {
  onClose: () => void;
}

export function OverlayPanel({ onClose }: OverlayPanelProps) {
  const overlays = useOverlayStore((s) => s.overlays);
  const addOverlay = useOverlayStore((s) => s.addOverlay);
  const removeOverlay = useOverlayStore((s) => s.removeOverlay);
  const toggleVisibility = useOverlayStore((s) => s.toggleVisibility);
  const setOpacity = useOverlayStore((s) => s.setOpacity);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        let kmlText: string;

        if (file.name.endsWith(".kmz")) {
          // Decompress KMZ
          const buffer = await file.arrayBuffer();
          const pako = await import("pako");
          // KMZ is a ZIP file. Find the local file header and extract.
          const bytes = new Uint8Array(buffer);
          // Simple extraction: skip 30-byte header + filename to get to compressed data
          const view = new DataView(buffer);
          const fileNameLen = view.getUint16(26, true);
          const extraLen = view.getUint16(28, true);
          const compressedSize = view.getUint32(18, true);
          const dataStart = 30 + fileNameLen + extraLen;
          const compressed = bytes.slice(dataStart, dataStart + compressedSize);
          const decompressed = pako.inflateRaw(compressed);
          kmlText = new TextDecoder().decode(decompressed);
        } else {
          kmlText = await file.text();
        }

        const result = parseKML(kmlText);

        const overlay: KmlOverlay = {
          id: randomId(),
          name: result.name || file.name.replace(/\.(kml|kmz)$/, ""),
          visible: true,
          opacity: 0.7,
          polygons: result.polygons,
          paths: result.paths,
          points: result.points,
          style: {
            lineColor: result.style.lineColor,
            fillColor: result.style.fillColor,
            lineWidth: result.style.lineWidth,
          },
          rawKml: kmlText,
        };

        addOverlay(overlay);
      } catch (err) {
        console.error("Failed to parse KML/KMZ:", err);
      }

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addOverlay],
  );

  return (
    <div className="absolute top-3 left-14 z-[1001] w-64 bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-[11px] font-mono font-semibold text-text-primary">
          KML Overlays
        </span>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>

      {/* Overlay list */}
      <div className="max-h-[280px] overflow-y-auto">
        {overlays.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] text-text-tertiary">
              No overlays loaded. Add a KML or KMZ file to display on the map.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {overlays.map((overlay) => (
              <OverlayItem
                key={overlay.id}
                overlay={overlay}
                onToggle={() => toggleVisibility(overlay.id)}
                onRemove={() => removeOverlay(overlay.id)}
                onOpacityChange={(v) => setOpacity(overlay.id, v)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <div className="px-3 py-2 border-t border-border-default">
        <input
          ref={fileInputRef}
          type="file"
          accept=".kml,.kmz"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={12} />}
          onClick={() => fileInputRef.current?.click()}
          className="w-full"
        >
          Add Overlay
        </Button>
      </div>
    </div>
  );
}

function OverlayItem({
  overlay,
  onToggle,
  onRemove,
  onOpacityChange,
}: {
  overlay: KmlOverlay;
  onToggle: () => void;
  onRemove: () => void;
  onOpacityChange: (v: number) => void;
}) {
  const featureCount =
    overlay.polygons.length + overlay.paths.length + overlay.points.length;

  return (
    <div className="px-3 py-2 border-b border-border-default last:border-b-0">
      <div className="flex items-center gap-2">
        {/* Color swatch */}
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: overlay.style.lineColor }}
        />

        {/* Name */}
        <span className="text-[11px] text-text-primary truncate flex-1">
          {overlay.name}
        </span>

        {/* Toggle visibility */}
        <button
          onClick={onToggle}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          {overlay.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Feature count + opacity slider */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[9px] text-text-tertiary font-mono shrink-0">
          {featureCount} features
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.opacity * 100)}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          className="flex-1 h-1 accent-accent-primary"
        />
        <span className="text-[9px] text-text-tertiary font-mono w-6 text-right">
          {Math.round(overlay.opacity * 100)}%
        </span>
      </div>
    </div>
  );
}
