"use client";

/**
 * @module vision/VisionInputsPanel
 * @description The Perception hub's inputs panel: the node's camera sources
 * (from the agent capability probe) and, when perception is running, which
 * camera each pipeline is reading from — so an operator sees which input feeds
 * which detector. Purely a view over the capability cameras + the live pipeline
 * streams; no extra agent round-trip.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Camera, Video } from "lucide-react";

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionPipelines } from "@/hooks/use-vision-pipelines";

export function VisionInputsPanel({ droneId }: { droneId: string }) {
  const t = useTranslations("vision");
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const pipelines = useVisionPipelines(droneId);

  // Group active pipeline streams by the camera id they read from.
  const byCamera = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of pipelines) {
      if (!p.active) continue;
      const models = map.get(p.cameraId) ?? [];
      models.push(p.modelId);
      map.set(p.cameraId, models);
    }
    return map;
  }, [pipelines]);

  const isEmpty = cameras.length === 0 && byCamera.size === 0;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-text-secondary">
        <Camera size={13} aria-hidden="true" />
        {t("inputs")}
      </h3>
      <p className="mb-2 text-[11px] text-text-tertiary">{t("inputsSubtitle")}</p>

      {isEmpty ? (
        <p className="py-3 text-center text-[11px] text-text-tertiary">
          {t("noInputs")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {cameras.map((cam, i) => (
            <div
              key={`cam-${i}`}
              className="flex items-center gap-2 rounded border border-border-default bg-bg-primary px-3 py-2"
            >
              <Camera
                size={12}
                className="flex-none text-text-tertiary"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-text-primary">
                  {cam.name}
                </div>
                <div className="font-mono text-[10px] text-text-tertiary">
                  {[cam.type, cam.resolution].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span
                className={`text-[9px] uppercase tracking-wide ${
                  cam.streaming ? "text-status-success" : "text-text-tertiary"
                }`}
              >
                {cam.streaming === null
                  ? t("cameraStreamUnknown")
                  : cam.streaming
                    ? t("cameraStreaming")
                    : t("cameraIdle")}
              </span>
            </div>
          ))}

          {/* Perception inputs: the camera ids the running pipelines read. */}
          {[...byCamera.entries()].map(([cameraId, models]) => (
            <div
              key={`input-${cameraId}`}
              className="flex items-center gap-2 rounded border border-border-default bg-bg-primary/60 px-3 py-2"
            >
              <Video
                size={12}
                className="flex-none text-accent-primary"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-text-secondary">
                  {cameraId}
                </div>
                <div className="truncate font-mono text-[10px] text-text-tertiary">
                  {t("inputFeeds", { models: models.join(", ") })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
