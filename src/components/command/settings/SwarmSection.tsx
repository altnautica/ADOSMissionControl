"use client";

/**
 * @module command/settings/SwarmSection
 * @description The node Settings "Swarm" page: this drone's multi-drone
 * coordination configuration — its fleet identity, the formation it defaults
 * to, the flocking weights and the collision-avoidance envelope. Every
 * writable field binds to the shared config writer, so a change is validated
 * by the agent and read back from the persisted config. The swarm role and
 * task-allocation keys are not offered: the onboard runtime reads neither and
 * nothing on the node runs the task auction, so a switch there would report
 * "Applied" for a setting with no effect.
 *
 * Three deliberate shapes:
 *   - The flocking gains are stored as integer PERCENTAGES of the float
 *     weight (40 means 0.40). The config field primitives have no float
 *     input, and inventing one for five fields would fork bounds validation.
 *   - The two separation values are the safety layer, so their Apply is held
 *     behind a danger confirm. Everything else writes on Apply directly.
 *   - Mode precedence is rendered as a static, non-editable ladder. Believing
 *     one mode governs a vehicle while another actually does is the classic
 *     supervisory-control loss; the ladder is a fact about the runtime, not a
 *     preference, so it is never offered as a control.
 *
 * Capability-gated by the page registry: offered while the node's config is
 * unknown or advertises the swarm block (demo mode always). A loaded document
 * without the block renders nothing here.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { isDemoMode } from "@/lib/utils";
import {
  SWARM_CONFIG_KEYS,
  SWARM_FORMATIONS,
} from "@/lib/swarm/config-keys";
import {
  ConfigIntField,
  ConfigReadonlyRow,
  ConfigSelectField,
  ConfigToggleField,
  type WriteConfirm,
} from "./ConfigFields";
import { SwarmFlockingFields } from "./SwarmFlockingFields";
import { configMayAdvertise } from "./use-node-config";
import { InfoNote, Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** The arbitration ladder, highest authority first. Label suffixes only — the
 * order is the content, so it lives in code rather than in a locale array a
 * translator could reorder. */
const PRECEDENCE_LEVELS = [
  "precedenceHardSeparation",
  "precedenceOperator",
  "precedenceFormation",
  "precedenceFlocking",
  "precedenceHold",
] as const;

export function SwarmSection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.swarm");

  if (!configMayAdvertise(config, "swarm") && !isDemoMode()) return null;

  const formationOptions = SWARM_FORMATIONS.map((value) => ({
    value,
    label: t(`formation_${value}`),
  }));

  const separationConfirm: WriteConfirm = {
    title: t("separationConfirmTitle"),
    message: t("separationConfirmMessage"),
    confirmLabel: t("separationConfirmAction"),
  };

  return (
    <Section title={t("title")} icon={Waypoints} blurb={t("blurb")}>
      {/* Honesty: the onboard swarm runtime does consume these keys, but it
          only commands the flight controller while Enabled is on and the
          aircraft reports GUIDED. Say so, so a successful write is not read
          as active swarm participation. */}
      <InfoNote>{t("runtimeNotice")}</InfoNote>

      {/* Identity — who this drone is in the fleet. The slot is issued by the
          ground station's registry at pair time and is never hand-edited: two
          drones on one slot share a wfb-ng channel_id and thrash each other's
          FEC decoder, which reads as unexplained link loss, not as a mistake. */}
      <div className="space-y-4">
        <div className="text-xs text-text-secondary">{t("identityTitle")}</div>
        <ConfigReadonlyRow
          configKey="video.wfb.fleet_slot"
          label={t("slotLabel")}
          hint={t("slotHint")}
          config={config}
          format={(raw) =>
            typeof raw !== "number" || !Number.isFinite(raw) || raw === 0
              ? null
              : t("slotValue", { slot: raw })
          }
        />
        <ConfigToggleField
          configKey={SWARM_CONFIG_KEYS.enabled}
          label={t("enabledLabel")}
          hint={t("enabledHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      {/* Formation — a closed set, because a name outside it produces no
          formation at all rather than an error the operator would notice. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("formationTitle")}</div>
        <ConfigSelectField
          configKey={SWARM_CONFIG_KEYS.formation}
          label={t("formationLabel")}
          hint={t("formationHint")}
          options={formationOptions}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigIntField
          configKey={SWARM_CONFIG_KEYS.spacing}
          label={t("spacingLabel")}
          hint={t("spacingHint")}
          min={1}
          max={1000}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      <SwarmFlockingFields
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Separation — the safety layer. Both writes pass a danger confirm. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">
          {t("separationTitle")}
        </div>
        <ConfigIntField
          configKey={SWARM_CONFIG_KEYS.separationRadiusM}
          label={t("sepRadiusLabel")}
          hint={t("sepRadiusHint")}
          min={1}
          max={200}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
          confirm={separationConfirm}
        />
        <ConfigIntField
          configKey={SWARM_CONFIG_KEYS.separationHardM}
          label={t("sepHardLabel")}
          hint={t("sepHardHint")}
          min={1}
          max={200}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
          confirm={separationConfirm}
        />
      </div>

      {/* Mode precedence — a fact about the arbiter, not a setting. */}
      <div className="space-y-2 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">
          {t("precedenceTitle")}
        </div>
        <p className="text-[11px] text-text-tertiary">{t("precedenceHint")}</p>
        <ol className="space-y-1">
          {PRECEDENCE_LEVELS.map((level, idx) => (
            <li
              key={level}
              className="flex items-baseline gap-2 rounded border border-border-default bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary"
            >
              <span className="font-mono text-[10px] text-text-tertiary">
                {idx + 1}
              </span>
              {t(level)}
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
