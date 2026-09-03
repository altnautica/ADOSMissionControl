/**
 * @module DisplayPortOsdPanel
 * @description Live preview of the OSD a Betaflight/iNav flight controller
 * pushes over MSP DisplayPort (182). Reconstructs the character grid the FC
 * paints so an HD-goggle / DJI OSD layout can be reviewed without goggles.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { Tv } from "lucide-react";
import { useDroneManager } from "@/stores/drone-manager";
import { useDisplayPortStore } from "@/stores/displayport-store";

export function DisplayPortOsdPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const lines = useDisplayPortStore((s) => s.lines);
  const resolutionLabel = useDisplayPortStore((s) => s.resolutionLabel);
  const lastFrameAt = useDisplayPortStore((s) => s.lastFrameAt);
  const attach = useDisplayPortStore((s) => s.attach);
  const detach = useDisplayPortStore((s) => s.detach);

  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (protocol) attach(protocol);
    return () => detach();
  }, [getSelectedProtocol, attach, detach]);

  const hasFrames = lastFrameAt !== null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <Tv size={16} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">OSD Preview</h2>
          <span className="ml-auto flex items-center gap-2 text-[10px] font-mono text-text-tertiary">
            <span>{resolutionLabel}</span>
            <span className={hasFrames ? "text-status-success" : "text-text-tertiary"}>
              {hasFrames ? "live" : "waiting"}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="inline-block bg-black border border-border-default p-3">
            <div
              className="font-mono text-[11px] leading-[1.35] text-gcs-hud-green"
              style={{ letterSpacing: "0.08em" }}
            >
              {lines.length > 0 ? (
                lines.map((line, r) => (
                  <div key={r} className="whitespace-pre">{line.length ? line : " "}</div>
                ))
              ) : (
                <div className="whitespace-pre text-text-tertiary">no OSD frames yet</div>
              )}
            </div>
          </div>
        </div>

        <p className="text-[10px] font-mono text-text-tertiary">
          Live reconstruction of the OSD the flight controller paints (MSP DisplayPort). Frames
          arrive only when the FC is configured to output its OSD over MSP DisplayPort on this
          connection (an HD-goggle / DJI setup). Custom font glyphs are shown as a dot; text and
          numeric fields render as sent.
        </p>
      </div>
    </div>
  );
}
