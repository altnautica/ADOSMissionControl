"use client";

/**
 * @module ReconstructQualitySelect
 * @description The reconstruction "detail level" picker for a drone's Atlas
 * capture surface. The operator chooses how much the compute node trains a
 * reconstruction (Draft → Maximum, mapping to Brush training steps — the one
 * real quality knob, no fabricated reading). The choice persists on the drone's atlas config
 * (`reconstruct_steps`, alongside the capture profile) and rides the reconstruct
 * job's `params.steps`. Rendered with the capture controls (both the setup
 * surface and the Live World tab) so it sits where a reconstruction is
 * commissioned, next to Start / Stop / Reconstruct now.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Select, type SelectOption } from "@/components/ui/select";
import type { AtlasControl } from "@/hooks/use-atlas-control";
import {
  RECONSTRUCTION_QUALITIES,
  DEFAULT_RECONSTRUCTION_STEPS,
  qualityForSteps,
  stepsForQuality,
} from "@/lib/atlas/reconstruction-quality";

export function ReconstructQualitySelect({
  control,
}: {
  control: AtlasControl;
}) {
  const t = useTranslations("atlas");
  const steps =
    control.readiness?.reconstructSteps ?? DEFAULT_RECONSTRUCTION_STEPS;
  const current = qualityForSteps(steps).id;
  const commandable = control.live || control.demo;

  const options: SelectOption[] = RECONSTRUCTION_QUALITIES.map((q) => ({
    value: q.id,
    label: t(q.labelKey),
    description: t(q.descKey),
  }));

  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-text-tertiary">{t("reconstructQuality.label")}</span>
      <div className="w-40">
        <Select
          options={options}
          value={current}
          onChange={(v) => void control.setReconstructSteps(stepsForQuality(v))}
          disabled={!commandable || control.busy}
        />
      </div>
    </div>
  );
}
