"use client";

/**
 * Fleet Coverage Modal — full-screen map with heatmap, polyline overlay,
 * and polygon geographic search.
 *
 * Phase 18 — coverage heatmap + polygon search.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import type { FlightRecord } from "@/lib/types";

const FleetCoverageMapInner = dynamic(() => import("./FleetCoverageMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[10px] font-mono text-text-tertiary">
      Loading map…
    </div>
  ),
});

interface FleetCoverageModalProps {
  open: boolean;
  records: FlightRecord[];
  onClose: () => void;
  onPolygonFilter?: (matchingIds: Set<string>) => void;
}

export function FleetCoverageModal({
  open,
  records,
  onClose,
  onPolygonFilter,
}: FleetCoverageModalProps) {
  const [matchCount, setMatchCount] = useState<number | null>(null);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const recordsWithPaths = records.filter((r) => r.path && r.path.length >= 2);

  const handlePolygonFilter = (ids: Set<string>) => {
    setMatchCount(ids.size > 0 ? ids.size : null);
    onPolygonFilter?.(ids);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Fleet Coverage
          </h3>
          <span className="text-[10px] font-mono text-text-tertiary">
            {recordsWithPaths.length} flights with paths · {records.length} total
          </span>
          {matchCount !== null && (
            <span className="text-[10px] font-mono text-status-success">
              {matchCount} matching polygon
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary transition-colors p-1"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <FleetCoverageMapInner
          records={recordsWithPaths}
          onPolygonFilter={handlePolygonFilter}
        />
      </div>
    </div>
  );
}
