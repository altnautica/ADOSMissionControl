"use client";

/**
 * @module command/settings/ThisComputerCard
 * @description The ground-station page for a personal computer.
 *
 * A ground station installed on somebody's own laptop or desktop runs a
 * different set of services from one on a dedicated box: it has no access point,
 * no HDMI kiosk, no status panel and no uplink router, because every one of those
 * would take over a machine its owner is using. Offering those pages here would
 * present settings the node never applies, so this page takes their place and
 * carries the one preference that machine does have.
 *
 * The toggle writes `host.share_on_lan` through the shared config writer. The
 * agent restarts its control front and media server when the value changes, so
 * the change is live rather than next-boot.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Laptop } from "lucide-react";

import { ConfigReadonlyRow, ConfigToggleField } from "./ConfigFields";
import { InfoNote, Section } from "./Section";

export interface ThisComputerCardProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function ThisComputerCard({
  config,
  readOnly,
  setValue,
}: ThisComputerCardProps) {
  const t = useTranslations("nodeSettings");

  return (
    <Section
      title={t("thisComputer.title")}
      icon={Laptop}
      blurb={t("thisComputer.blurb")}
    >
      <ConfigReadonlyRow
        configKey="host.share_on_lan"
        label={t("thisComputer.reachLabel")}
        hint={t("thisComputer.reachHint")}
        config={config}
        format={(raw) =>
          raw === true
            ? t("thisComputer.reachShared")
            : t("thisComputer.reachLocal")
        }
      />
      <ConfigToggleField
        configKey="host.share_on_lan"
        label={t("thisComputer.shareLabel")}
        hint={t("thisComputer.shareHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <InfoNote>{t("thisComputer.leftAlone")}</InfoNote>
    </Section>
  );
}
