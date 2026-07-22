"use client";

/**
 * @module hardware/radio/AdapterHealthPills
 * @description The badge-row rendering of a radio adapter's self-reported
 * health, shared by every panel that shows a link's badge row.
 *
 * A badge row is exception-driven: it exists to interrupt, so it carries the
 * chipset identity and the states that need acting on, and stays quiet
 * otherwise. Quiet is not a claim of health here — the always-present labelled
 * surfaces (the radio health tiles, the ground-station link card) render the
 * ok and unknown states in full, so nothing has to read silence as good news.
 *
 * @license GPL-3.0-only
 */

import { Radio as RadioIcon, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { resolveAdapterInjection, resolveAdapterUsb } from "./adapter-health";

export interface AdapterHealthPillsProps {
  /** Chipset the node identified for its selected adapter. */
  chipset: string | null | undefined;
  /** The node's injection verdict. Null / undefined means it reported none. */
  injectionOk: boolean | null | undefined;
  /** The node's USB verdict. Null / undefined means it reported none. */
  usbDegraded: boolean | null | undefined;
  /** Enumerated USB link speed in Mbps, when reported. */
  usbSpeedMbps: number | null | undefined;
}

export function AdapterHealthPills({
  chipset,
  injectionOk,
  usbDegraded,
  usbSpeedMbps,
}: AdapterHealthPillsProps) {
  const t = useTranslations("hardware.radio");
  const injection = resolveAdapterInjection({ injectionOk, chipset });
  const usb = resolveAdapterUsb({ degraded: usbDegraded, speedMbps: usbSpeedMbps });

  return (
    <>
      {injection.state === "failed" ? (
        <span className="inline-flex items-center gap-1.5 rounded border border-status-error/40 bg-status-error/10 px-2.5 py-1 text-xs text-status-error">
          <ShieldAlert size={12} />
          {t("adapterNoInjection")}
        </span>
      ) : injection.chipset ? (
        <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary px-2.5 py-1 text-xs text-text-tertiary">
          <RadioIcon size={12} />
          {t("adapterChipset", { chipset: injection.chipset })}
        </span>
      ) : null}
      {usb.state === "degraded" ? (
        <span
          className="inline-flex items-center gap-1.5 rounded border border-status-error/40 bg-status-error/10 px-2.5 py-1 text-xs text-status-error"
          title={t("adapterUsbDegradedHint")}
        >
          <ShieldAlert size={12} />
          {usb.speedMbps != null
            ? t("adapterUsbDegradedSpeed", { speed: usb.speedMbps })
            : t("adapterUsbDegraded")}
        </span>
      ) : null}
    </>
  );
}
