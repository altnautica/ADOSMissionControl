"use client";

/**
 * @module TargetDesignation
 * @description Click-on-video overlay to designate a tracking target.
 * Captures click coordinates relative to the video frame dimensions
 * and sends them to the agent for tracker initialization.
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { Crosshair } from "lucide-react";

interface TargetDesignationProps {
  /** Called when the user clicks to designate a target. Coordinates are in frame pixels. */
  onDesignate: (x: number, y: number, frameWidth: number, frameHeight: number) => void;
  /** Natural video frame width for coordinate mapping. */
  frameWidth: number;
  /** Natural video frame height. */
  frameHeight: number;
  /** Whether designation is currently enabled. */
  enabled: boolean;
}

export function TargetDesignation({
  onDesignate,
  frameWidth,
  frameHeight,
  enabled,
}: TargetDesignationProps) {
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      // Convert to frame pixel coordinates
      const frameX = Math.round(relX * frameWidth);
      const frameY = Math.round(relY * frameHeight);

      setLastClick({ x: relX * 100, y: relY * 100 });
      onDesignate(frameX, frameY, frameWidth, frameHeight);

      // Clear the click indicator after 1s
      setTimeout(() => setLastClick(null), 1000);
    },
    [enabled, frameWidth, frameHeight, onDesignate]
  );

  if (!enabled) return null;

  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      onClick={handleClick}
    >
      {/* Click hint */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 bg-black/60 rounded-full text-[10px] text-white/80 pointer-events-none">
        <Crosshair size={10} />
        Click on a target to designate
      </div>

      {/* Click ripple indicator */}
      {lastClick && (
        <div
          className="absolute w-6 h-6 -ml-3 -mt-3 pointer-events-none"
          style={{ left: `${lastClick.x}%`, top: `${lastClick.y}%` }}
        >
          <div className="w-full h-full border-2 border-accent-primary rounded-full animate-ping" />
          <div className="absolute inset-1 border border-accent-primary rounded-full" />
        </div>
      )}
    </div>
  );
}
