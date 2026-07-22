"use client";

/**
 * @module hardware/radio/LinkHealthCard
 * @description Telemetry card surfacing the live WFB-ng link health
 * (RSSI, bitrate, channel, FEC counters) plus the topology + link
 * state badges and the brownout warning pill.
 * @license GPL-3.0-only
 */

import { Radio as RadioIcon, AlertTriangle, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  RadioLinkState,
  RadioLinkDiag,
  RadioTopology,
} from "@/lib/api/ground-station/types";
import { EMPTY, rssiClass, topologyClass } from "./constants";
import {
  linkStateLabel,
  linkStateBadgeClass,
  linkDiagLabel,
  linkDiagBadgeClass,
  radioStackStateLabel,
  topologyLabel,
  type RadioStackState,
} from "./labels";
import { StatRow } from "./StatRow";
import { AdapterHealthPills } from "./AdapterHealthPills";

export interface LinkHealthCardProps {
  topology: RadioTopology;
  linkState: RadioLinkState;
  showBrownoutWarning: boolean;
  pollError: string | null;
  rssiDbm: number | null;
  bitrateMbps: number | null;
  channel: number | null;
  freqMhz: number | null;
  bandwidthMhz: number | null;
  fecRecovered: number;
  fecLost: number;
  driver: string | null;
  iface: string | null;
  // Receive-side link quality. Optional — older agents and the local
  // LAN poll omit them, so each row only renders when a value arrives.
  snrDb?: number | null;
  noiseDbm?: number | null;
  lossPercent?: number | null;
  mcsIndex?: number | null;
  rxSilentSeconds?: number | null;
  // Per-stream video-tx liveness. When true, the agent's watchdog has
  // detected a wedged video transmitter and is restarting it; the count
  // is how many times it has had to. Both null/absent on older agents
  // and on the receive side.
  txVideoStalled?: boolean | null;
  txVideoStallKills?: number | null;
  // True when the control link is up (paired + peer heard) but no valid
  // WFB packets are decoding on the ground — the radio handshake worked
  // yet the video downlink isn't flowing.
  pairedNoVideo?: boolean;
  // Per-second valid WFB decode rate on the ground. Null on the transmit
  // side and on older agents.
  validRxPacketsPerS?: number | null;
  // Count of destructive ground wfb_rx restarts the valid-packet
  // watchdog has fired. A climbing value means the receive link is
  // thrashing. Null on the transmit side and on older agents.
  reacquireKills?: number | null;
  // Count of restarts the receive liveness watchdog fired because
  // wfb_rx was alive yet had stopped decoding (a process-silent stall,
  // distinct from a decode thrash). Null on the transmit side and on
  // older agents.
  rxZombieKills?: number | null;
  // Selected WFB radio adapter chipset (e.g. "RTL8812EU"). Null/absent
  // on older agents.
  adapterChipset?: string | null;
  // True when the selected adapter entered monitor mode and can inject.
  // An explicit false means no injection-capable adapter was found and
  // the agent refuses to transmit. Null/absent on older agents — no
  // adapter warning renders in that case.
  adapterInjectionOk?: boolean | null;
  // True when the selected adapter enumerated on a slow (full-speed, 12 Mbps)
  // USB link instead of high-speed: the driver advances its tx_bytes counter
  // yet no usable RF leaves the antenna. `adapterUsbSpeedMbps` is the
  // enumerated speed. Null/absent on older agents.
  adapterUsbDegraded?: boolean | null;
  adapterUsbSpeedMbps?: number | null;
  // Coarse radio-stack health rollup from the agent heartbeat: "ok" or
  // the reason the stack is not transmitting (no injection adapter,
  // unpaired, missing bind keys, or an incomplete radio stack). Null or
  // absent on older agents — the row only renders when a value arrives.
  radioStackState?: RadioStackState | null;
  // WFB link-diagnosis verdict + received-frame counters. The verdict
  // chip and the two counter rows only render when the agent reports
  // them; older agents omit these, so a missing value shows nothing (no
  // fabricated "healthy" verdict, no fabricated 0 counter).
  linkDiag?: RadioLinkDiag | null;
  packetsAll?: number | null;
  decryptErrors?: number | null;
  // Live transmit config (what wfb_tx is actually sending). `fecK`/`fecN`
  // are the running Reed-Solomon ratio; `adaptiveBitrateEnabled` flags the
  // closed-loop controller and `recommendedTierName` is its current rung.
  // Null/absent on older agents — the FEC-ratio row and link-mode pill only
  // render when reported.
  fecK?: number | null;
  fecN?: number | null;
  adaptiveBitrateEnabled?: boolean | null;
  recommendedTierName?: string | null;
}

/** Percent parity overhead of a Reed-Solomon (k, n) ratio, e.g. 8/12 → 50. */
function fecRedundancyPct(k: number, n: number): number {
  return k > 0 ? Math.round(((n - k) / k) * 100) : 0;
}

export function LinkHealthCard({
  topology,
  linkState,
  showBrownoutWarning,
  pollError,
  rssiDbm,
  bitrateMbps,
  channel,
  freqMhz,
  bandwidthMhz,
  fecRecovered,
  fecLost,
  driver,
  iface,
  snrDb,
  noiseDbm,
  lossPercent,
  mcsIndex,
  rxSilentSeconds,
  txVideoStalled,
  txVideoStallKills,
  pairedNoVideo,
  validRxPacketsPerS,
  reacquireKills,
  rxZombieKills,
  adapterChipset,
  adapterInjectionOk,
  adapterUsbDegraded,
  adapterUsbSpeedMbps,
  radioStackState,
  linkDiag,
  packetsAll,
  decryptErrors,
  fecK,
  fecN,
  adaptiveBitrateEnabled,
  recommendedTierName,
}: LinkHealthCardProps) {
  const t = useTranslations("hardware.radio");
  // Link-mode pill: "Adaptive · <rung>" when the controller is armed, else
  // "Manual". Only shown when the agent reports the flag (older agents omit it).
  const linkModeLabel =
    adaptiveBitrateEnabled == null
      ? null
      : adaptiveBitrateEnabled
        ? recommendedTierName
          ? t("linkModeAdaptive", { tier: recommendedTierName })
          : t("linkModeAdaptiveBare")
        : t("linkModeManual");
  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${topologyClass(topology)}`}
        >
          <RadioIcon size={12} />
          {topologyLabel(t, topology)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${linkStateBadgeClass(linkState)}`}
        >
          {linkStateLabel(t, linkState)}
        </span>
        {linkDiag != null ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${linkDiagBadgeClass(linkDiag)}`}
            title={t("linkDiag.label")}
          >
            <RadioIcon size={12} />
            {linkDiagLabel(t, linkDiag)}
          </span>
        ) : null}
        {linkModeLabel ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
              adaptiveBitrateEnabled
                ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                : "border-border-default bg-bg-tertiary text-text-tertiary"
            }`}
          >
            {linkModeLabel}
          </span>
        ) : null}
        {showBrownoutWarning ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-warning/40 bg-status-warning/10 px-2.5 py-1 text-xs text-status-warning">
            <AlertTriangle size={12} />
            {t("brownoutWarning")}
          </span>
        ) : null}
        <AdapterHealthPills
          chipset={adapterChipset}
          injectionOk={adapterInjectionOk}
          usbDegraded={adapterUsbDegraded}
          usbSpeedMbps={adapterUsbSpeedMbps}
        />
        {txVideoStalled ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-error/40 bg-status-error/10 px-2.5 py-1 text-xs text-status-error">
            <AlertTriangle size={12} />
            {t("videoTxStalled")}
          </span>
        ) : null}
        {pairedNoVideo === true ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-warning/40 bg-status-warning/10 px-2.5 py-1 text-xs text-status-warning">
            <VideoOff size={12} />
            {t("pairedNoVideo")}
          </span>
        ) : validRxPacketsPerS != null && validRxPacketsPerS > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-xs text-status-success">
            <RadioIcon size={12} />
            {t("linkedBadge")}
          </span>
        ) : null}
      </div>

      {pollError ? (
        <div className="mb-3 rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          {pollError}
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <StatRow
          label={t("rssi")}
          value={rssiDbm == null ? EMPTY : `${rssiDbm.toFixed(0)} dBm`}
          valueClass={rssiClass(rssiDbm)}
        />
        <StatRow
          label={t("bitrate")}
          value={
            bitrateMbps == null
              ? EMPTY
              : `${bitrateMbps.toFixed(1)} Mbps`
          }
        />
        <StatRow
          label={t("channel")}
          value={
            channel == null
              ? EMPTY
              : freqMhz == null
                ? `CH ${channel}`
                : `CH ${channel} (${freqMhz.toFixed(0)} MHz)`
          }
        />
        <StatRow
          label={t("bandwidth")}
          value={bandwidthMhz == null ? EMPTY : `${bandwidthMhz} MHz`}
        />
        <StatRow label={t("fecRecovered")} value={String(fecRecovered)} />
        <StatRow label={t("fecLost")} value={String(fecLost)} />
        {packetsAll != null ? (
          <StatRow
            label={t("packetsAll")}
            value={String(packetsAll)}
            title={t("packetsAllHint")}
          />
        ) : null}
        {decryptErrors != null ? (
          <StatRow
            label={t("decryptErrors")}
            value={String(decryptErrors)}
            valueClass={decryptErrors > 0 ? "text-status-warning" : undefined}
            title={t("decryptErrorsHint")}
          />
        ) : null}
        {snrDb != null ? (
          <StatRow label={t("snr")} value={`${snrDb.toFixed(0)} dB`} />
        ) : null}
        {lossPercent != null ? (
          <StatRow label={t("loss")} value={`${lossPercent.toFixed(1)}%`} />
        ) : null}
        {mcsIndex != null ? (
          <StatRow label={t("mcs")} value={String(mcsIndex)} />
        ) : null}
        {fecK != null && fecN != null ? (
          <StatRow
            label={t("fecRatio")}
            value={`${fecK} / ${fecN} (${fecRedundancyPct(fecK, fecN)}%)`}
          />
        ) : null}
        {noiseDbm != null ? (
          <StatRow label={t("noise")} value={`${noiseDbm.toFixed(0)} dBm`} />
        ) : null}
        {rxSilentSeconds != null ? (
          <StatRow label={t("rxIdle")} value={`${rxSilentSeconds.toFixed(1)} s`} />
        ) : null}
        {validRxPacketsPerS != null ? (
          <StatRow
            label={t("validRxRate")}
            value={`${validRxPacketsPerS.toFixed(0)} /s`}
            valueClass={
              validRxPacketsPerS <= 0 ? "text-status-warning" : undefined
            }
          />
        ) : null}
        {reacquireKills != null && reacquireKills > 0 ? (
          <StatRow
            label={t("reacquireKills")}
            value={String(reacquireKills)}
            valueClass="text-status-warning"
            title={t("reacquireKillsHint")}
          />
        ) : null}
        {rxZombieKills != null && rxZombieKills > 0 ? (
          <StatRow
            label={t("rxZombieKills")}
            value={String(rxZombieKills)}
            valueClass="text-status-warning"
            title={t("rxZombieKillsHint")}
          />
        ) : null}
        {txVideoStallKills != null && txVideoStallKills > 0 ? (
          <StatRow
            label={t("videoTxRecoveries")}
            value={String(txVideoStallKills)}
          />
        ) : null}
        {radioStackState ? (
          <StatRow
            label={t("radioStack")}
            value={radioStackStateLabel(t, radioStackState)}
            valueClass={
              radioStackState !== "ok" ? "text-status-warning" : undefined
            }
            title={t("radioStackHint")}
          />
        ) : null}
        {driver ? <StatRow label={t("driver")} value={driver} /> : null}
        {iface ? <StatRow label={t("iface")} value={iface} /> : null}
      </dl>
    </section>
  );
}
