"use client";

/**
 * @module command/settings/CorePages
 * @description The small core settings pages that used to live inline in the
 * Settings tab body: Profile (read-only — a switch is a transactional setup
 * change), Cloud posture (read-only — mode + backend URL are a transactional
 * pair), and Advanced (per-key log level + read-only board override). The
 * board override is file-sourced (`/etc/ados/board_override`, injected onto
 * the GET response only) and is not a writable config field, so it renders
 * read-only rather than as a control that rejects every write.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { ConfigReadonlyRow, ConfigSelectField } from "./ConfigFields";
import { Section } from "./Section";

interface PageProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** Map a stored option value to its display label; unknown values render raw. */
function labelFor(
  opts: { value: string; label: string }[],
  raw: unknown,
): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  return opts.find((o) => o.value === raw)?.label ?? raw;
}

/** Profile — read-only in v1 (a switch is a transactional setup change). */
export function ProfilePage({ config }: Pick<PageProps, "config">) {
  const t = useTranslations("nodeSettings");
  const profileOptions = [
    { value: "drone", label: t("profile.optionDrone") },
    { value: "ground-station", label: t("profile.optionGroundStation") },
    { value: "workstation", label: t("profile.optionWorkstation") },
  ];
  return (
    <Section title={t("profile.title")}>
      <ConfigReadonlyRow
        configKey="agent.profile"
        label={t("profile.label")}
        hint={t("profile.hint")}
        config={config}
        format={(raw) => labelFor(profileOptions, raw)}
      />
    </Section>
  );
}

/** Cloud posture — read-only in v1 (mode + backend URL are a transactional
 * pair). */
export function CloudPage({ config }: Pick<PageProps, "config">) {
  const t = useTranslations("nodeSettings");
  const cloudModeOptions = [
    { value: "local", label: t("cloud.optionLocal") },
    { value: "cloud", label: t("cloud.optionCloud") },
    { value: "self_hosted", label: t("cloud.optionSelfHosted") },
  ];
  return (
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
  );
}

/** Advanced — per-key log level + board override. */
export function AdvancedPage({ config, readOnly, setValue }: PageProps) {
  const t = useTranslations("nodeSettings");
  const logLevelOptions = [
    { value: "debug", label: "DEBUG" },
    { value: "info", label: "INFO" },
    { value: "warning", label: "WARNING" },
    { value: "error", label: "ERROR" },
  ];
  return (
    <Section title={t("advanced.title")}>
      <ConfigSelectField
        configKey="logging.level"
        label={t("advanced.logLevelLabel")}
        options={logLevelOptions}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <ConfigReadonlyRow
        configKey="agent.board_override"
        label={t("advanced.boardOverrideLabel")}
        hint={t("advanced.boardOverrideHint")}
        config={config}
        format={(raw) =>
          typeof raw === "string" && raw.length > 0
            ? raw
            : t("advanced.boardOverrideAuto")
        }
      />
    </Section>
  );
}
