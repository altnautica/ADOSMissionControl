"use client";

/**
 * @module command/settings/RadioSection
 * @description The node Settings "Radio" page: everything that configures the
 * WFB-ng radio itself — fleet addressing, the link preset / band / hopping
 * switches, and the modulation rung — split out of the Video page, which now
 * owns cameras and encoding alone.
 *
 * Three of the values here are deliberately NOT writable:
 *   - `fleet_slot` is issued by the ground station's fleet registry at pair
 *     time. Two transmitters sharing a slot share a wfb-ng `channel_id`, and
 *     each one then re-initialises the other's FEC decoder about once a second
 *     — which presents as unexplained link loss, not as a config error. So the
 *     surface reports the assigned slot and never offers to change it.
 *   - `channel` is owned by pairing and automatic hopping.
 *   - `tx_power_dbm` is owned live by the Link tab's power slider.
 *
 * There is no channel-width control: the transmitter is pinned to 20 MHz
 * (10 MHz needs a driver rebuild, 40 MHz has open defects on this chipset),
 * so offering a width selector would imply a capability the driver lacks.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { RadioTower } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import {
  ConfigIntField,
  ConfigReadonlyRow,
  ConfigSelectField,
  ConfigToggleField,
} from "./ConfigFields";
import { configAdvertises, readConfigPath } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** The top rung the adaptive ladder is built to reach. A cap AT the ceiling
 * constrains nothing, so the readout drops the "capped N" clause there. */
const LADDER_CEILING_MCS = 5;

/** A labeled live reading that is NOT a config key — the running modulation
 * rung and the SNR it was chosen against. Mirrors `ConfigReadonlyRow`'s
 * markup so a live row and a stored row read as one list. */
function LiveRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value: string | null;
}) {
  const t = useTranslations("nodeSettings.radio");
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        {hint ? (
          <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>
        ) : null}
      </div>
      <div className="shrink-0 font-mono text-sm text-text-primary">
        {value ?? <span className="text-text-tertiary">{t("noReading")}</span>}
      </div>
    </div>
  );
}

export function RadioSection({
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings.radio");
  // The running rung, not the configured one: an adaptive ladder step or a
  // manual change lands here first, so the operator always sees what the
  // transmitter is actually doing (the same active-vs-commanded rule the
  // Swarm table's mode column follows).
  const radio = useAgentCapabilitiesStore((s) => s.radio);

  // A workstation carries no WFB radio.
  if (profile !== "drone" && profile !== "ground-station") return null;

  const hasWfb = configAdvertises(config, "video.wfb");
  if (!hasWfb) {
    return (
      <Section title={t("title")} icon={RadioTower} blurb={t("blurb")}>
        <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
          {t("notAdvertised")}
        </div>
      </Section>
    );
  }

  const presetOptions = [
    { value: "conservative", label: t("presetConservative") },
    { value: "balanced", label: t("presetBalanced") },
    { value: "aggressive", label: t("presetAggressive") },
  ];
  const bandOptions = [
    { value: "u-nii-1", label: t("bandUnii1") },
    { value: "u-nii-3", label: t("bandUnii3") },
    { value: "all", label: t("bandAll") },
  ];

  const adaptive = readConfigPath(config, "video.wfb.adaptive_bitrate_enabled");
  const adaptiveOn = adaptive === true;
  // Measured off-air, not a config echo: this is the peer's real transmit
  // rung. Null before a frame decodes — and 0 is a real rung, so an absent
  // reading must never render as MCS 0.
  const liveMcs = radio?.mcsIndex ?? null;
  const liveSnr = radio?.snrDb ?? null;
  const liveCap = radio?.mcsLadderCap ?? null;
  const baseRung =
    liveMcs == null
      ? null
      : liveSnr == null
        ? t("rungNoSnr", { mcs: liveMcs })
        : t("rung", { mcs: liveMcs, snr: Math.round(liveSnr) });
  // A cap below the ladder ceiling is why a strong link can sit low; at the
  // ceiling it explains nothing, so the clause is dropped.
  const liveRung =
    baseRung !== null && liveCap !== null && liveCap < LADDER_CEILING_MCS
      ? t("rungCapped", { rung: baseRung, cap: liveCap })
      : baseRung;

  return (
    <Section title={t("title")} icon={RadioTower} blurb={t("blurb")}>
      {/* Fleet addressing — which fleet this node belongs to, and which slot
          within it the ground station assigned. */}
      <div className="space-y-4">
        <div className="text-xs text-text-secondary">{t("fleetTitle")}</div>
        <ConfigIntField
          configKey="video.wfb.fleet_id"
          label={t("fleetIdLabel")}
          hint={t("fleetIdHint")}
          min={1}
          max={65535}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigReadonlyRow
          configKey="video.wfb.fleet_slot"
          label={t("fleetSlotLabel")}
          hint={t("fleetSlotHint")}
          config={config}
          format={(raw) =>
            typeof raw !== "number" || !Number.isFinite(raw)
              ? null
              : raw === 0
                ? t("fleetSlotGround")
                : t("fleetSlotDrone", { slot: raw })
          }
        />
      </div>

      {/* Link — the writable radio behaviour switches. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("linkTitle")}</div>
        <ConfigSelectField
          configKey="video.wfb.wfb_link_preset"
          label={t("presetLabel")}
          hint={t("presetHint")}
          options={presetOptions}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigSelectField
          configKey="video.wfb.band"
          label={t("bandLabel")}
          hint={t("bandHint")}
          options={bandOptions}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigToggleField
          configKey="video.wfb.auto_hop_enabled"
          label={t("autoHopLabel")}
          hint={t("autoHopHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigToggleField
          configKey="video.wfb.adaptive_bitrate_enabled"
          label={t("adaptiveLabel")}
          hint={t("adaptiveHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      {/* Modulation — the manual rung disappears while the ladder owns it, so
          there is never a writable field the controller silently overrides. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">
          {t("modulationTitle")}
        </div>
        {adaptiveOn ? (
          <>
            <LiveRow
              label={t("mcsAutoLabel")}
              hint={t("mcsAutoHint")}
              value={
                liveRung === null ? null : t("mcsAutoValue", { rung: liveRung })
              }
            />
            {/* The cap is why a healthy 35 dB link can sit at MCS 3: policy,
                not a degraded link. Writable, because it is the only rung
                decision left to the operator once the ladder owns the rest. */}
            <ConfigIntField
              configKey="video.wfb.adaptive_mcs_max"
              label={t("mcsCapLabel")}
              hint={t("mcsCapHint")}
              min={1}
              max={5}
              config={config}
              readOnly={readOnly}
              setValue={setValue}
            />
          </>
        ) : (
          <>
            <ConfigIntField
              configKey="video.wfb.mcs_index"
              label={t("mcsLabel")}
              hint={t("mcsHint")}
              min={0}
              max={7}
              config={config}
              readOnly={readOnly}
              setValue={setValue}
            />
            <LiveRow
              label={t("mcsLiveLabel")}
              hint={t("mcsLiveHint")}
              value={liveRung}
            />
          </>
        )}
      </div>

      {/* Owned elsewhere — read-only so this page never runs a second writer:
          the pairing/auto-hop machinery owns the channel, the Link tab's
          slider owns live TX power. */}
      <div className="space-y-2 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("ownedTitle")}</div>
        <ConfigReadonlyRow
          configKey="video.wfb.channel"
          label={t("channelLabel")}
          hint={t("channelHint")}
          config={config}
        />
        <ConfigReadonlyRow
          configKey="video.wfb.tx_power_dbm"
          label={t("txPowerLabel")}
          hint={t("txPowerHint")}
          config={config}
        />
      </div>
    </Section>
  );
}
