"use client";

/**
 * @module command/settings/BatterySection
 * @description The Setup half of the node's Battery page: the thresholds the
 * agent's battery engine evaluates every flight-controller battery report
 * against. Every field binds to the shared config writer, so the agent
 * validates the value and the page reads it back from the persisted config.
 *
 * The keys are integers by design (millivolts, tenths of a degree per second,
 * whole seconds and percent): the config field primitives have no float
 * input. The bounds here are the agent's own validation bounds, so an
 * out-of-range value is refused in the field before it reaches the node.
 *
 * Capability-gated by the page registry: offered while the node's config is
 * unknown or advertises the battery block (demo mode always). A loaded
 * document without the block renders nothing here.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { BatteryMedium } from "lucide-react";

import { isDemoMode } from "@/lib/utils";
import { ConfigIntField, ConfigToggleField } from "./ConfigFields";
import { configMayAdvertise } from "./use-node-config";
import { InfoNote, Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** The integer thresholds, in page order, with the agent's validation bounds.
 * `name` is the locale stem for the field's label and hint. */
const THRESHOLD_FIELDS = [
  { key: "low_cell_mv", name: "lowCellMv", min: 2500, max: 4200 },
  { key: "critical_cell_mv", name: "criticalCellMv", min: 2500, max: 4000 },
  { key: "cell_divergence_mv", name: "cellDivergenceMv", min: 10, max: 500 },
  { key: "voltage_drop_mv_per_s", name: "voltageDropMvPerS", min: 100, max: 5000 },
  { key: "temp_spike_dc_per_s", name: "tempSpikeDcPerS", min: 5, max: 200 },
  { key: "predictive_window_s", name: "predictiveWindowS", min: 5, max: 300 },
  { key: "reserve_percent", name: "reservePercent", min: 5, max: 50 },
] as const;

export function BatterySection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.battery");

  if (!configMayAdvertise(config, "battery") && !isDemoMode()) return null;

  return (
    <Section title={t("title")} icon={BatteryMedium} blurb={t("blurb")}>
      <ConfigToggleField
        configKey="battery.enabled"
        label={t("enabledLabel")}
        hint={t("enabledHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <div className="space-y-4 border-t border-border-default pt-3">
        <InfoNote>{t("orderNote")}</InfoNote>
        {THRESHOLD_FIELDS.map((field) => (
          <ConfigIntField
            key={field.key}
            configKey={`battery.${field.key}`}
            label={t(`${field.name}Label`)}
            hint={t(`${field.name}Hint`)}
            min={field.min}
            max={field.max}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
        ))}
      </div>
    </Section>
  );
}
