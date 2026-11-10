"use client";

/**
 * @module cockpit/layers/VisionViewPanel
 * @description The panel of the cockpit's Vision view, beside the video in
 * landscape and stacked under it in portrait: the live detection list for
 * the displayed camera, the detector model picker, the depth and surfaces
 * layer options (both layers are on while the view is open) and the engine
 * summary.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { ModelPicker } from "@/components/vision/ModelPicker";
import { VisionSummaryCard } from "@/components/vision/VisionSummaryCard";
import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { cn } from "@/lib/utils";
import {
  useCockpitLayersStore,
  useVehicleLayers,
  type DepthRange,
  type DepthStyle,
} from "@/stores/cockpit-layers-store";

const DEPTH_RANGES: readonly DepthRange[] = ["off", "2", "5"];
const DEPTH_STYLES: readonly DepthStyle[] = ["solid", "outline"];
/** Rows shown in the detection list. */
const MAX_ROWS = 12;

export function VisionViewPanel({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpitLayers");
  const batch = useDisplayedDetectionBatch(droneId);
  const vl = useVehicleLayers(droneId);
  const setDepth = useCockpitLayersStore((s) => s.setDepth);
  const detections = batch?.detections ?? [];

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto p-3 text-xs" data-testid="vision-view-panel">
      <section>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">{t("detections")}</h3>
        {detections.length === 0 ? (
          <p className="text-text-tertiary">{t("noDetections")}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="vision-detection-list">
            {detections.slice(0, MAX_ROWS).map((d, i) => (
              <li
                key={d.trackId ?? `i${i}`}
                className="flex items-center justify-between rounded bg-white/5 px-2 py-1 font-mono"
              >
                <span>
                  {d.classLabel}
                  {d.trackId != null && <span className="text-text-tertiary"> #{d.trackId}</span>}
                </span>
                <span className="tabular-nums text-text-secondary">{Math.round(d.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">{t("model")}</h3>
        <ModelPicker droneId={droneId} mode="compact" />
      </section>

      <section>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">{t("depthOptions")}</h3>
        <p className="mb-2 text-text-tertiary">{t("visionForced")}</p>
        <div className="flex gap-1">
          {DEPTH_STYLES.map((v) => (
            <Choice key={v} on={vl.depthStyle === v} onClick={() => setDepth(droneId, v, vl.depthRange)}>
              {t(`depthStyle.${v}`)}
            </Choice>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {DEPTH_RANGES.map((v) => (
            <Choice key={v} on={vl.depthRange === v} onClick={() => setDepth(droneId, vl.depthStyle, v)}>
              {t(`depthRange.${v}`)}
            </Choice>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">{t("engine")}</h3>
        <VisionSummaryCard droneId={droneId} />
      </section>
    </aside>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-12 flex-1 rounded px-2 text-[11px]",
        on ? "bg-accent-primary text-white" : "bg-white/5 text-text-secondary hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
