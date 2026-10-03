"use client";

/**
 * @module EthernetSection
 * @description Ethernet status card. Read-only stat dl + a Configure button
 * that opens the EthernetConfigModal at the parent level. Configure is always
 * offered on a ground station: the IPv4 profile is a setting of the box, not
 * of a cable being plugged in. A reading the agent did not make shows "—".
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { EthernetStatus, EthernetConfig } from "@/lib/api/ground-station/types";
import { StatRow } from "./StatRow";

const UNKNOWN = "—";

interface Props {
  /** `undefined` until the network snapshot loads; `null` when the board has
   * no wired port. */
  ethernet: EthernetStatus | null | undefined;
  ethernetConfig: EthernetConfig | null;
  onConfigure: () => void;
}

export function EthernetSection({ ethernet, ethernetConfig, onConfigure }: Props) {
  const t = useTranslations("hardware.ethernet");
  const link = ethernet?.link ?? null;
  const mode = ethernetConfig?.mode ?? null;
  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">{t("title")}</h2>
        <Button variant="secondary" size="sm" onClick={onConfigure}>
          {t("configure")}
        </Button>
      </div>
      {ethernet === null ? (
        <div className="text-sm text-text-secondary">{t("noPort")}</div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <StatRow
            label={t("link")}
            value={link === null ? UNKNOWN : link ? t("up") : t("down")}
            valueClass={link ? "text-status-success" : "text-text-tertiary"}
          />
          <StatRow
            label={t("speed")}
            value={
              ethernet?.speed_mbps != null
                ? t("speedValue", { speed: ethernet.speed_mbps })
                : UNKNOWN
            }
          />
          <StatRow label={t("interface")} value={ethernet?.iface ?? UNKNOWN} />
          <StatRow label={t("ip")} value={ethernet?.ip ?? UNKNOWN} />
          <StatRow label={t("gateway")} value={ethernet?.gateway ?? UNKNOWN} />
          <StatRow label={t("mode")} value={mode === null ? UNKNOWN : t(mode)} />
        </dl>
      )}
    </section>
  );
}
