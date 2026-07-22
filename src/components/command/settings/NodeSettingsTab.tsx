"use client";

/**
 * @module command/settings/NodeSettingsTab
 * @description The node-detail Settings tab. Brings the agent's web-console
 * Settings page into the GCS under the "Onboard computer" group: the first-party
 * Features (World Model), the operating Region (the existing
 * RegulatoryRegionPanel), plus per-key Network / Advanced writes and read-only
 * Profile / Cloud status. Every writable field reads its value from the live
 * agent config and writes back over the LAN with a read-back confirm.
 *
 * v1 writes per-key fields only (region, hotspot, log level, board override).
 * Profile and cloud posture are multi-field transactional changes, so they show
 * as read-only status here (managed in the setup flow) until a batch-apply GCS
 * wrapper lands — the surface never ships a partial, inconsistent write.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";
import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { RegulatoryRegionPanel } from "@/components/command/system/RegulatoryRegionPanel";
import { NodeFeaturesTile } from "@/components/features/NodeFeaturesTile";
import { featuresForProfile } from "@/components/features/registry";
import { useNodeConfig } from "./use-node-config";
import {
  ConfigSelectField,
  ConfigTextField,
  ConfigReadonlyRow,
} from "./ConfigFields";
import { PerceptionOffloadSection } from "./PerceptionOffloadSection";
import { NetworkUplinkSection } from "./NetworkUplinkSection";
import { WifiClientSection } from "./WifiClientSection";
import { CellularSection } from "./CellularSection";
import { MacPinSection } from "./MacPinSection";
import { SelfHealSection } from "./SelfHealSection";
import { MavlinkRoutingSection } from "./MavlinkRoutingSection";
import { SecuritySection } from "./SecuritySection";
import { Section } from "./Section";

export function NodeSettingsTab({
  droneId,
  profile,
}: {
  droneId: string;
  profile: NodeProfile;
}) {
  const t = useTranslations("nodeSettings");
  const { config, loading, readOnly, error, setValue } = useNodeConfig();

  const hasFeatures = featuresForProfile(profile).length > 0;

  const profileOptions = [
    { value: "drone", label: t("profile.optionDrone") },
    { value: "ground-station", label: t("profile.optionGroundStation") },
    { value: "workstation", label: t("profile.optionWorkstation") },
  ];
  const cloudModeOptions = [
    { value: "local", label: t("cloud.optionLocal") },
    { value: "cloud", label: t("cloud.optionCloud") },
    { value: "self_hosted", label: t("cloud.optionSelfHosted") },
  ];
  const logLevelOptions = [
    { value: "debug", label: "DEBUG" },
    { value: "info", label: "INFO" },
    { value: "warning", label: "WARNING" },
    { value: "error", label: "ERROR" },
  ];

  const labelFor = (opts: { value: string; label: string }[], raw: unknown) => {
    if (typeof raw !== "string" || raw.length === 0) return null;
    return opts.find((o) => o.value === raw)?.label ?? raw;
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            {t("title")}
          </h1>
          <p className="text-xs text-text-secondary">{t("subtitle")}</p>
        </div>
      </div>

      {readOnly ? (
        <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
          {t("readOnlyNoAgent")}
        </div>
      ) : loading && !config ? (
        <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
          {t("loading")}
        </div>
      ) : error ? (
        <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
          {t("loadFailed")}
        </div>
      ) : null}

      {/* First-party features (World Model, …) — opt-in per node. Renders
          nothing on a profile with no opt-in features. */}
      {hasFeatures ? (
        <Section title={t("features.title")}>
          <NodeFeaturesTile droneId={droneId} profile={profile} />
        </Section>
      ) : null}

      {/* Profile — read-only in v1 (a switch is a transactional setup change). */}
      <Section title={t("profile.title")}>
        <ConfigReadonlyRow
          configKey="agent.profile"
          label={t("profile.label")}
          hint={t("profile.hint")}
          config={config}
          format={(raw) => labelFor(profileOptions, raw)}
        />
      </Section>

      {/* Region — the existing writable operating-region control. */}
      <RegulatoryRegionPanel />

      {/* Perception offload — drone offload client / workstation serving.
          Renders nothing on a ground-station node. */}
      <PerceptionOffloadSection
        droneId={droneId}
        profile={profile}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Network — the uplink matrix + priority ladder (ground station) and
          the config-backed hotspot switch (every profile). */}
      <NetworkUplinkSection
        profile={profile}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Wi-Fi — scan → join, disconnect, saved networks. Profile-agnostic
          on the agent (any node with a wlan interface can join). */}
      <WifiClientSection />

      {/* Cellular — modem presence/state + APN, enable and data-cap writes
          (ground station); config-backed keys elsewhere. */}
      <CellularSection
        profile={profile}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* MAC pinning — adapter stability report + the pin-service switches.
          Profile-agnostic (any node can carry a no-efuse adapter). */}
      <MacPinSection config={config} readOnly={readOnly} setValue={setValue} />

      {/* Self-heal — the exposed protection switches, the always-on guardian
          and reconciler as live status, and the recent-heal activity feed. */}
      <SelfHealSection config={config} readOnly={readOnly} setValue={setValue} />

      {/* MAVLink — FC transport + endpoints read-only, router identity and
          relay forwarding rates writable, signing state on a drone. */}
      <MavlinkRoutingSection
        profile={profile}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Security — key state (never a value), the exposed auth switches,
          and the dashboard-PIN posture pointing at the Health tab's card. */}
      <SecuritySection config={config} readOnly={readOnly} setValue={setValue} />

      {/* Cloud posture — read-only in v1 (mode + backend URL are a
          transactional pair). */}
      <Section title={t("cloud.title")}>
        <ConfigReadonlyRow
          configKey="server.mode"
          label={t("cloud.modeLabel")}
          hint={t("cloud.modeHint")}
          config={config}
          format={(raw) => labelFor(cloudModeOptions, raw)}
        />
        <ConfigReadonlyRow
          configKey="server.self_hosted.convex_url"
          label={t("cloud.backendLabel")}
          config={config}
        />
      </Section>

      {/* Advanced — per-key log level + board override. */}
      <Section title={t("advanced.title")}>
        <ConfigSelectField
          configKey="logging.level"
          label={t("advanced.logLevelLabel")}
          options={logLevelOptions}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigTextField
          configKey="agent.board_override"
          label={t("advanced.boardOverrideLabel")}
          hint={t("advanced.boardOverrideHint")}
          placeholder={t("advanced.boardOverridePlaceholder")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </Section>
    </div>
  );
}
