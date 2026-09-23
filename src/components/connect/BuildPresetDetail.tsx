"use client";

import { useTranslations } from "next-intl";
import type { BuildPreset } from "@/lib/presets/types";
import { X } from "lucide-react";

export function BuildPresetDetail({
  preset,
  onClose,
}: {
  preset: BuildPreset;
  onClose: () => void;
}) {
  const t = useTranslations("connect.buildPreset");
  const yesNo = (v: boolean) => (v ? t("yes") : t("no"));
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-semibold text-text-primary font-display">
            {preset.name}
          </h4>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {preset.description}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-tertiary hover:text-text-primary cursor-pointer"
          aria-label={t("close")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Specs summary */}
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <SpecItem label={t("spec.props")} value={preset.specs.propSize} />
        <SpecItem label={t("spec.motors")} value={`${preset.specs.motorSize} ${preset.specs.motorKv}KV`} />
        <SpecItem label={t("spec.battery")} value={`${preset.specs.cells}S ${preset.specs.batteryMah}mAh`} />
        <SpecItem label={t("spec.auw")} value={`${preset.specs.auwGrams}g`} />
        <SpecItem
          label={t("spec.flightTime")}
          value={t("spec.minutes", { count: preset.specs.flightTimeMin })}
        />
        <SpecItem label={t("spec.gps")} value={yesNo(preset.specs.hasGps)} />
        <SpecItem label={t("spec.compass")} value={yesNo(preset.specs.hasCompass)} />
        <SpecItem label={t("spec.rangefinder")} value={yesNo(preset.specs.hasRangefinder)} />
      </div>

      {/* Component list */}
      <div>
        <h5 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
          {t("components")}
        </h5>
        <div className="space-y-0.5">
          {preset.components.map((comp, i) => (
            <div
              key={`${comp.type}-${comp.name}-${i}`}
              className="flex items-center justify-between text-[10px] py-0.5 px-1.5 bg-bg-primary/50"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary font-mono w-16 shrink-0">
                  {t(`componentType.${comp.type}`)}
                </span>
                <span className="text-text-secondary">
                  {comp.count > 1 ? `${comp.count}× ` : ""}
                  {comp.name}
                </span>
              </div>
              {comp.details && (
                <span className="text-text-tertiary font-mono text-[9px]">
                  {Object.values(comp.details).slice(0, 2).join(" · ")}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-tertiary font-mono text-[9px]">{label}</div>
      <div className="text-text-secondary">{value}</div>
    </div>
  );
}
