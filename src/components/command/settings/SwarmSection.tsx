"use client";

/**
 * @module command/settings/SwarmSection
 * @description The node Settings "Swarm" page: the multi-drone coordination
 * configuration stored on this node's agent (participation switch, role
 * preference, default formation and spacing). Every field binds to the shared
 * config writer, so a change is validated by the agent and read back from the
 * persisted config.
 *
 * Capability-gated: renders only when the node's own config surface
 * advertises the swarm block — an agent that predates it (or a node with no
 * config path) shows no page. Demo mode renders the page (read-only) so the
 * surface stays exercisable offline.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { isDemoMode } from "@/lib/utils";
import {
  ConfigIntField,
  ConfigTextField,
  ConfigToggleField,
} from "./ConfigFields";
import { configAdvertises } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function SwarmSection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.swarm");

  if (!configAdvertises(config, "swarm") && !isDemoMode()) return null;

  return (
    <Section title={t("title")} icon={Waypoints} blurb={t("blurb")}>
      {/* Honesty: these keys are stored on the node but no agent runtime
          consumes them yet (the swarm service has not shipped). Say so, so a
          successful write is not read as active swarm participation. */}
      <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
        {t("runtimeNotice")}
      </div>

      <ConfigToggleField
        configKey="swarm.enabled"
        label={t("enabledLabel")}
        hint={t("enabledHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      <div className="space-y-4 border-t border-border-default pt-3">
        <ConfigTextField
          configKey="swarm.role"
          label={t("roleLabel")}
          hint={t("roleHint")}
          placeholder="auto"
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigTextField
          configKey="swarm.default_formation"
          label={t("formationLabel")}
          hint={t("formationHint")}
          placeholder="line"
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigIntField
          configKey="swarm.default_spacing"
          label={t("spacingLabel")}
          hint={t("spacingHint")}
          min={1}
          max={1000}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>
    </Section>
  );
}
