"use client";

/**
 * Manual video-source override panel (SITL, Gazebo, or a forced WHEP URL),
 * shown over a {@link VideoCanvas}. Saving an empty URL returns the drone to
 * its paired agent's camera.
 *
 * @license GPL-3.0-only
 */

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const WHEP_PRESETS = [
  { label: "Gazebo SITL", url: "http://localhost:8889/gazebo-cam/whep" },
  // A genuinely local example: the agent's own front is :8080, not
  // mediamtx's :8889.
  { label: "Agent (this host)", url: "http://localhost:8080/whep" },
];

interface VideoSourceConfigPanelProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function VideoSourceConfigPanel({ url, onUrlChange, onSave, onClose }: VideoSourceConfigPanelProps) {
  return (
    <div className="absolute inset-0 z-20 bg-bg-primary/95 flex items-center justify-center">
      <div className="w-80 space-y-3 p-4 border border-border-default bg-bg-primary">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary">Video Source (WHEP)</span>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary cursor-pointer">
            <X size={14} />
          </button>
        </div>
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="http://localhost:8889/gazebo-cam/whep"
          label="WHEP Endpoint URL"
        />
        <p className="text-[10px] text-text-tertiary leading-relaxed">
          Leave empty to use the paired agent&apos;s camera automatically.
        </p>
        <div className="flex flex-wrap gap-1">
          {WHEP_PRESETS.map((p) => (
            <button
              key={p.url}
              onClick={() => onUrlChange(p.url)}
              className={cn(
                "px-2 py-0.5 text-[9px] font-mono border transition-colors cursor-pointer",
                url === p.url
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-default text-text-tertiary hover:text-text-secondary"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={onSave}
          className="w-full py-1.5 text-xs font-semibold bg-accent-primary text-accent-foreground hover:bg-accent-primary/90 transition-colors cursor-pointer"
        >
          {url ? "Connect" : "Use Agent Camera"}
        </button>
      </div>
    </div>
  );
}
