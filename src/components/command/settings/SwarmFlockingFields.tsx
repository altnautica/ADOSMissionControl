"use client";

/**
 * @module command/settings/SwarmFlockingFields
 * @description The Swarm page's Advanced-disclosure band: the five
 * Olfati-Saber flocking weights. Collapsed by default — these are tuning
 * constants, not operating decisions, and the page's resting state should be
 * the handful of choices an operator actually makes.
 *
 * The three gains are stored as integer PERCENTAGES of the float weight the
 * runtime applies (40 means 0.40): the config field primitives carry no float
 * input, and adding one for these five fields would fork bounds validation
 * away from the shared integer parser. Each gain's hint carries the float that
 * will actually be applied, so the encoding is never something the operator
 * has to infer from the number in the box.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  SWARM_CONFIG_KEYS,
  SWARM_GAIN_MAX_PERCENT,
  SWARM_GAIN_MIN_PERCENT,
  gainPercentToFloat,
} from "@/lib/swarm/config-keys";
import { ConfigIntField } from "./ConfigFields";
import { readConfigPath } from "./use-node-config";

interface Props {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function SwarmFlockingFields({ config, readOnly, setValue }: Props) {
  const t = useTranslations("nodeSettings.swarm");
  const [open, setOpen] = useState(false);

  const gainHint = (hintKey: string, configKey: string) => {
    const gain = gainPercentToFloat(readConfigPath(config, configKey));
    return gain === null
      ? t(hintKey)
      : `${t(hintKey)} ${t("gainApplied", { gain: gain.toFixed(2) })}`;
  };

  return (
    <div className="space-y-3 border-t border-border-default pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-text-secondary">{t("flockTitle")}</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? t("advancedHide") : t("advancedShow")}
        </button>
      </div>
      {open ? (
        <div className="space-y-4">
          <ConfigIntField
            configKey={SWARM_CONFIG_KEYS.flockCohesion}
            label={t("cohesionLabel")}
            hint={gainHint("cohesionHint", SWARM_CONFIG_KEYS.flockCohesion)}
            min={SWARM_GAIN_MIN_PERCENT}
            max={SWARM_GAIN_MAX_PERCENT}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigIntField
            configKey={SWARM_CONFIG_KEYS.flockAlignment}
            label={t("alignmentLabel")}
            hint={gainHint("alignmentHint", SWARM_CONFIG_KEYS.flockAlignment)}
            min={SWARM_GAIN_MIN_PERCENT}
            max={SWARM_GAIN_MAX_PERCENT}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigIntField
            configKey={SWARM_CONFIG_KEYS.flockSeparationGain}
            label={t("separationGainLabel")}
            hint={gainHint(
              "separationGainHint",
              SWARM_CONFIG_KEYS.flockSeparationGain,
            )}
            min={SWARM_GAIN_MIN_PERCENT}
            max={SWARM_GAIN_MAX_PERCENT}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigIntField
            configKey={SWARM_CONFIG_KEYS.flockRadiusM}
            label={t("flockRadiusLabel")}
            hint={t("flockRadiusHint")}
            min={1}
            max={500}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigIntField
            configKey={SWARM_CONFIG_KEYS.flockNeighbors}
            label={t("flockNeighborsLabel")}
            hint={t("flockNeighborsHint")}
            min={1}
            max={24}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
        </div>
      ) : null}
    </div>
  );
}
