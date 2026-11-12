/**
 * @module DisplayPortOsdPanel
 * @description Live preview of the OSD a Betaflight/iNav flight controller
 * pushes over MSP DisplayPort (182). Reconstructs the character grid the FC
 * paints so an HD-goggle / DJI OSD layout can be reviewed without goggles.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Tv } from "lucide-react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useDisplayPortStore } from "@/stores/displayport-store";
import { useIsFresh } from "@/stores/clock-store";

export function DisplayPortOsdPanel() {
  const tr = useTranslations("fcPanels.displayPortOsdPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const lines = useDisplayPortStore((s) => s.lines);
  const resolutionLabel = useDisplayPortStore((s) => s.resolutionLabel);
  const lastFrameAt = useDisplayPortStore((s) => s.lastFrameAt);
  const attach = useDisplayPortStore((s) => s.attach);
  const detach = useDisplayPortStore((s) => s.detach);

  // Re-attached on a drone switch, so the preview never keeps painting the
  // previously selected drone's OSD.
  useEffect(() => {
    const protocol = selectedProtocol;
    if (protocol) attach(protocol);
    return () => detach();
  }, [selectedProtocol, selectedDroneId, attach, detach]);

  // Re-evaluated on the shared 1 Hz clock so a stream that stops turns stale.
  const live = useIsFresh(lastFrameAt);
  const status = lastFrameAt === null ? "waiting" : live ? "live" : "stale";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <Tv size={16} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">{tr("osdPreview")}</h2>
          <span className="ml-auto flex items-center gap-2 text-[10px] font-mono text-text-tertiary">
            <span>{resolutionLabel}</span>
            <span
              className={
                status === "live" ? "text-status-success" : status === "stale" ? "text-status-warning" : "text-text-tertiary"
              }
            >
              {status}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="inline-block bg-media border border-border-default p-3">
            <div
              className="font-mono text-[11px] leading-[1.35] text-gcs-hud-green"
              style={{ letterSpacing: "0.08em" }}
            >
              {lines.length > 0 ? (
                lines.map((line, r) => (
                  <div key={r} className="whitespace-pre">{line.length ? line : " "}</div>
                ))
              ) : (
                <div className="whitespace-pre text-text-tertiary">{tr("noFramesYet")}</div>
              )}
            </div>
          </div>
        </div>

        <p className="text-[10px] font-mono text-text-tertiary">
          {tr("liveReconstructionOfTheOSD")}
        </p>
      </div>
    </div>
  );
}
