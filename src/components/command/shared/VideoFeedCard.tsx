"use client";

import { CameraOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoFeedCardProps {
  className?: string;
  onPopOut?: () => void;
}

export function VideoFeedCard({ className, onPopOut }: VideoFeedCardProps) {
  return (
    <div
      className={cn(
        "relative border border-border-default rounded-lg overflow-hidden bg-bg-secondary",
        className
      )}
    >
      {/* 16:9 aspect ratio container */}
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
          <CameraOff className="w-8 h-8 text-text-tertiary" />
          <span className="text-xs text-text-tertiary font-mono tracking-widest">
            NO SIGNAL
          </span>
        </div>
      </div>

      {/* Pop-out button */}
      <button
        onClick={onPopOut}
        className="absolute top-2 right-2 p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
        title="Pop out video"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
