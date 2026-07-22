"use client";

/**
 * @module GroundStationLinkCard
 * @description Compact RX-link health card for the GroundStationOverview.
 * Surfaces RSSI, bitrate, FEC ratio, and channel for the WFB-ng radio, plus
 * the two health readings the receive adapter makes about itself: its USB
 * link and whether it can inject. A ground station's receive adapter can fail
 * in exactly the ways an air-side one can, and every quality figure above it
 * keeps reading plausibly when it does, so the adapter's own report belongs
 * beside them rather than only on the air side.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { toneTextClass } from "@/components/hardware/radio/labels";
import {
  resolveAdapterInjection,
  resolveAdapterUsb,
  adapterInjectionLabel,
  adapterUsbLabel,
} from "@/components/hardware/radio/adapter-health";

function rssiTone(dbm: number | null): string {
  if (dbm === null) return "text-text-tertiary";
  if (dbm > -65) return "text-status-success";
  if (dbm > -78) return "text-status-warning";
  return "text-status-error";
}

function snrTone(db: number | null): string {
  if (db === null) return "text-text-tertiary";
  if (db >= 20) return "text-status-success";
  if (db >= 10) return "text-status-warning";
  return "text-status-error";
}

// RX-liveness: the receiver stamps this ~0 while frames flow. A growing
// value (or a stalled link) means the downlink has gone quiet.
function rxIdleTone(seconds: number | null): string {
  if (seconds === null) return "text-text-tertiary";
  if (seconds < 3) return "text-status-success";
  if (seconds < 10) return "text-status-warning";
  return "text-status-error";
}

export function GroundStationLinkCard() {
  const t = useTranslations("groundStationOverview.link");
  // Adapter phrases live in the shared radio catalogue so the ground station
  // and the air side name the same reading the same way.
  const tRadio = useTranslations("hardware.radio");
  const health = useGroundStationStore((s) => s.linkHealth);
  const radio = useAgentCapabilitiesStore((s) => s.radio);
  const fecTotal = health.fec_rec + health.fec_lost;
  const fecRatio = fecTotal > 0 ? (health.fec_lost / fecTotal) * 100 : 0;

  // Both readings are the node's own; an absent one renders as unknown, never
  // rounded up to healthy.
  const usb = resolveAdapterUsb({
    degraded: radio?.adapterUsbDegraded,
    speedMbps: radio?.adapterUsbSpeedMbps,
  });
  const injection = resolveAdapterInjection({
    injectionOk: radio?.adapterInjectionOk,
    chipset: radio?.adapterChipset,
  });

  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary p-3 space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-text-tertiary">
        {t("title")}
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-tertiary">{t("rssi")}</dt>
        <dd className={`${rssiTone(health.rssi_dbm)} tabular-nums`}>
          {health.rssi_dbm !== null ? `${health.rssi_dbm} dBm` : "—"}
        </dd>

        <dt className="text-text-tertiary">{t("bitrate")}</dt>
        <dd className="text-text-primary tabular-nums">
          {health.bitrate_mbps !== null
            ? `${health.bitrate_mbps.toFixed(1)} Mbps`
            : "—"}
        </dd>

        <dt className="text-text-tertiary">{t("fecLost")}</dt>
        <dd
          className={
            fecRatio > 5
              ? "text-status-warning tabular-nums"
              : "text-text-secondary tabular-nums"
          }
        >
          {fecTotal > 0 ? `${fecRatio.toFixed(1)}%` : "—"}
        </dd>

        <dt className="text-text-tertiary">{t("channel")}</dt>
        <dd className="text-text-primary tabular-nums">
          {health.channel ?? "—"}
        </dd>
      </dl>

      {radio && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-t border-border-default pt-2">
          <dt className="text-text-tertiary">{t("snr")}</dt>
          <dd className={`${snrTone(radio.snrDb)} tabular-nums`}>
            {radio.snrDb !== null ? `${radio.snrDb.toFixed(0)} dB` : "—"}
          </dd>

          <dt className="text-text-tertiary">{t("loss")}</dt>
          <dd
            className={
              radio.lossPercent !== null && radio.lossPercent > 5
                ? "text-status-warning tabular-nums"
                : "text-text-secondary tabular-nums"
            }
          >
            {radio.lossPercent !== null
              ? `${radio.lossPercent.toFixed(1)}%`
              : "—"}
          </dd>

          <dt className="text-text-tertiary">{t("freq")}</dt>
          <dd className="text-text-primary tabular-nums">
            {radio.freqMhz !== null ? `${radio.freqMhz} MHz` : "—"}
          </dd>

          <dt className="text-text-tertiary">{t("mcs")}</dt>
          <dd className="text-text-primary tabular-nums">
            {radio.mcsIndex ?? "—"}
          </dd>

          <dt className="text-text-tertiary">{t("noise")}</dt>
          <dd className="text-text-secondary tabular-nums">
            {radio.noiseDbm !== null ? `${radio.noiseDbm} dBm` : "—"}
          </dd>

          <dt className="text-text-tertiary">{t("rxIdle")}</dt>
          <dd className={`${rxIdleTone(radio.rxSilentSeconds)} tabular-nums`}>
            {radio.rxSilentSeconds !== null
              ? `${radio.rxSilentSeconds.toFixed(1)} s`
              : "—"}
          </dd>

          {/* Receive-link thrash counters. A receiver that keeps
              destructively restarting (valid-packet watchdog) or that
              silently stops decoding while still alive (liveness
              watchdog) is a degraded ground link. Render only when a
              counter has actually fired so a healthy link, the transmit
              side, and older agents stay clean. */}
          {radio.reacquireKills !== null && radio.reacquireKills > 0 && (
            <>
              <dt className="text-text-tertiary">{t("reacquires")}</dt>
              <dd className="text-status-warning tabular-nums">
                {radio.reacquireKills}
              </dd>
            </>
          )}

          {radio.rxZombieKills !== null && radio.rxZombieKills > 0 && (
            <>
              <dt className="text-text-tertiary">{t("rxRestarts")}</dt>
              <dd className="text-status-warning tabular-nums">
                {radio.rxZombieKills}
              </dd>
            </>
          )}

          {/* Receive-adapter health. Always rendered, including the unknown
              case: a missing reading is the operator's cue that the node
              never reported one, which silence here would hide. */}
          <dt className="text-text-tertiary">{t("usbLink")}</dt>
          <dd
            className={toneTextClass(usb.tone)}
            title={
              usb.state === "degraded"
                ? tRadio("adapterUsbDegradedHint")
                : undefined
            }
          >
            {adapterUsbLabel(tRadio, usb)}
          </dd>

          <dt className="text-text-tertiary">{t("adapter")}</dt>
          <dd className={toneTextClass(injection.tone)}>
            {adapterInjectionLabel(tRadio, injection)}
          </dd>
        </dl>
      )}
    </div>
  );
}
