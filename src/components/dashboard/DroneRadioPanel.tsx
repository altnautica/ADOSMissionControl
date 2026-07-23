"use client";

/**
 * @module DroneRadioPanel
 * @description Air-side radio view for a single drone. Reads the radio
 * snapshot from the per-drone capability store (populated by the cloud
 * heartbeat) and renders link state, topology, channel, FEC stats, and
 * the TX power slider. The slider commits TX power against the drone's
 * own agent because air-side TX is what's being adjusted.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  Radio as RadioIcon,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { TxPowerSlider } from "@/components/hardware/TxPowerSlider";
import { WifiPowersaveCard } from "@/components/hardware/network/WifiPowersaveCard";
import {
  linkDiagLabel,
  linkDiagBadgeClass,
  linkStateLabel,
  linkStateBadgeClass,
  linkStateReach,
  topologyLabel,
} from "@/components/hardware/radio/labels";
import { AdapterHealthPills } from "@/components/hardware/radio/AdapterHealthPills";
import type {
  RadioLinkState,
  RadioState,
  RadioTopology,
  SetTxPowerResult,
} from "@/lib/api/ground-station/types";

const EMPTY = "…";

// RSSI color thresholds. Air-side rarely receives its own beacon so
// rssiDbm may be null on most drones. The note below explains why.
const RSSI_GREEN_DBM = -55;
const RSSI_YELLOW_DBM = -75;

// Brownout warning fires when host-VBUS topology is paired with TX
// power above the soft floor.
const BROWNOUT_TX_FLOOR_DBM = 12;

// Conservative default cap when the agent has not advertised a per-driver
// maximum. Matches the ground-side default for parity.
const DEFAULT_TX_MAX_DBM = 15;

// Default initial slider value when neither the live TX power nor a
// last-seen value is available.
const DEFAULT_INITIAL_TX_DBM = 5;

interface DroneRadioPanelProps {
  droneId: string;
}

function rssiClass(dbm: number | null): string {
  if (dbm == null) return "text-text-tertiary";
  if (dbm >= RSSI_GREEN_DBM) return "text-status-success";
  if (dbm >= RSSI_YELLOW_DBM) return "text-status-warning";
  return "text-status-error";
}

function topologyClass(topology: RadioTopology): string {
  if (topology === "external_5v") {
    return "border-status-success/40 text-status-success";
  }
  if (topology === "powered_hub") {
    return "border-accent-primary/40 text-accent-primary";
  }
  return "border-border-default text-text-secondary";
}

export function DroneRadioPanel({ droneId }: DroneRadioPanelProps) {
  const t = useTranslations("hardware.radio");
  const tDrone = useTranslations("droneRadio");

  const radio = useAgentCapabilitiesStore((s) => s.radio);
  const wfbFailoverState = useAgentCapabilitiesStore(
    (s) => s.wfbFailoverState,
  );
  // The agent URL the panel will hit for TX power apply. In the
  // current architecture this is whichever agent the GCS is connected
  // to; cloud mode reuses the same connection store. A future per-drone
  // URL field on the capability store would let multi-drone control
  // surfaces target each agent independently. See report for the gap.
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  if (!radio) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary text-text-tertiary">
          <RadioIcon size={24} />
        </div>
        <h2 className="text-sm font-display font-semibold text-text-primary">
          {t("notSupported")}
        </h2>
      </div>
    );
  }

  const linkState: RadioLinkState = radio.state;
  const topology: RadioTopology = radio.topology;
  const rssiDbm = radio.rssiDbm;
  const bitrateKbps = radio.bitrateKbps;
  const bitrateMbps = bitrateKbps != null ? bitrateKbps / 1000 : null;
  const channel = radio.channel;
  const freqMhz = radio.freqMhz;
  const bandwidthMhz = radio.bandwidthMhz;
  const fecRecovered = radio.fecRecovered;
  const fecLost = radio.fecLost;
  const driver = radio.driver;
  const iface = radio.iface;
  // Live transmit config: rate (MCS), Reed-Solomon ratio, and adaptive mode.
  const mcsIndex = radio.mcsIndex;
  const fecK = radio.fecK;
  const fecN = radio.fecN;
  const adaptiveBitrateEnabled = radio.adaptiveBitrateEnabled;
  const recommendedTierName = radio.recommendedTierName;
  const linkModeLabel =
    adaptiveBitrateEnabled == null
      ? null
      : adaptiveBitrateEnabled
        ? recommendedTierName
          ? t("linkModeAdaptive", { tier: recommendedTierName })
          : t("linkModeAdaptiveBare")
        : t("linkModeManual");
  const txPowerDbm = radio.txPowerDbm;
  const txPowerMaxDbm =
    radio.txPowerMaxDbm > 0 ? radio.txPowerMaxDbm : DEFAULT_TX_MAX_DBM;

  const showBrownoutWarning =
    topology === "host_vbus" &&
    txPowerDbm != null &&
    txPowerDbm > BROWNOUT_TX_FLOOR_DBM;

  // WFB link-diagnosis verdict + received-frame counters. Null when the
  // agent doesn't report them (older agents); the chip and the counter
  // rows only render when a real value arrives.
  const linkDiag = radio.linkDiag;
  const packetsAll = radio.packetsAll;
  const decryptErrors = radio.decryptErrors;

  // The drone does not typically receive its own RF, so a null RSSI here is
  // expected — but WHICH explanation is truthful depends on the link (Rule 44).
  // On a link that is carrying frames (connected / degraded) the value lives on
  // the ground side, so the note points there. On an unverified link
  // (rf_unverified) nothing has confirmed reception, so pointing the operator at
  // the ground station would misdirect — the ground station has no RSSI to
  // report either. On a down link the "…" placeholder is self-explanatory and
  // no note is shown.
  const rssiHint =
    rssiDbm != null
      ? undefined
      : linkStateReach(linkState) === "up"
        ? tDrone("rssiAirNote")
        : linkStateReach(linkState) === "unproven"
          ? tDrone("rssiUnverifiedNote")
          : undefined;

  const onApply = async (dbm: number): Promise<SetTxPowerResult> => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) {
      throw new Error(tDrone("noAgent"));
    }
    return api.setTxPower(dbm);
  };

  const initialSliderValue = txPowerDbm ?? DEFAULT_INITIAL_TX_DBM;
  const safeMax = Math.max(1, txPowerMaxDbm);
  // Hostname for the typed-phrase confirmation. Falls back to the
  // device id for traceability when the agent has not surfaced an mDNS
  // host.
  const confirmHostname = droneId;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
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
          <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary px-2.5 py-1 text-xs text-text-tertiary">
            {tDrone("airSideBadge")}
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
            chipset={radio.adapterChipset}
            injectionOk={radio.adapterInjectionOk}
            usbDegraded={radio.adapterUsbDegraded}
            usbSpeedMbps={radio.adapterUsbSpeedMbps}
          />
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <StatRow
            label={t("rssi")}
            value={rssiDbm == null ? EMPTY : `${rssiDbm.toFixed(0)} dBm`}
            valueClass={rssiClass(rssiDbm)}
            hint={rssiHint}
          />
          <StatRow
            label={t("bitrate")}
            value={
              bitrateMbps == null ? EMPTY : `${bitrateMbps.toFixed(1)} Mbps`
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
            value={
              bandwidthMhz == null || bandwidthMhz === 0
                ? EMPTY
                : `${bandwidthMhz} MHz`
            }
          />
          {mcsIndex != null ? (
            <StatRow label={t("mcs")} value={String(mcsIndex)} />
          ) : null}
          {fecK != null && fecN != null ? (
            <StatRow
              label={t("fecRatio")}
              value={`${fecK} / ${fecN} (${fecK > 0 ? Math.round(((fecN - fecK) / fecK) * 100) : 0}%)`}
            />
          ) : null}
          <StatRow label={t("fecRecovered")} value={String(fecRecovered)} />
          <StatRow label={t("fecLost")} value={String(fecLost)} />
          {packetsAll != null ? (
            <StatRow
              label={t("packetsAll")}
              value={String(packetsAll)}
              hint={t("packetsAllHint")}
            />
          ) : null}
          {decryptErrors != null ? (
            <StatRow
              label={t("decryptErrors")}
              value={String(decryptErrors)}
              valueClass={
                decryptErrors > 0 ? "text-status-warning" : undefined
              }
              hint={t("decryptErrorsHint")}
            />
          ) : null}
          {driver ? <StatRow label={t("driver")} value={driver} /> : null}
          {iface ? <StatRow label={t("iface")} value={iface} /> : null}
        </dl>
      </section>

      <DronePairingTile t={t} radio={radio} wfbFailoverState={wfbFailoverState} />

      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <h3 className="mb-1 text-sm font-semibold text-text-primary">
          {t("txPower")}
        </h3>
        <p className="mb-1 text-xs text-text-tertiary">
          {t("txPowerHardCap", { max: safeMax })}
        </p>
        <p className="mb-4 text-xs text-text-tertiary">
          {tDrone("txPowerScopeHint")}
        </p>
        <TxPowerSlider
          currentDbm={txPowerDbm}
          maxDbm={safeMax}
          initialValue={initialSliderValue}
          confirmHostname={confirmHostname}
          onApply={onApply}
          disabled={!agentUrl}
        />
        {!agentUrl ? (
          <p className="mt-3 text-xs text-status-warning">
            {tDrone("noAgent")}
          </p>
        ) : null}
      </section>

      <WifiPowersaveCard />
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}

function StatRow({ label, value, valueClass, hint }: StatRowProps) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-default py-1.5">
      <div className="flex items-baseline justify-between">
        <dt className="text-xs uppercase tracking-wide text-text-secondary">
          {label}
        </dt>
        <dd
          className={`font-mono text-sm ${valueClass ?? "text-text-primary"}`}
        >
          {value}
        </dd>
      </div>
      {hint ? (
        <p className="text-[10px] text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

interface DronePairingTileProps {
  t: ReturnType<typeof useTranslations>;
  radio: RadioState;
  wfbFailoverState: "local" | "cloud_relay" | "failed";
}

function DronePairingTile({
  t,
  radio,
  wfbFailoverState,
}: DronePairingTileProps) {
  // Read-only mirror of the GS-side card. The drone-side panel does
  // not initiate bind sessions because the drone runs the bind
  // server; the GS is the conductor. Operators trigger pairing from
  // the GS card or by long-pressing B3 on the LCD.
  const paired = radio.paired === true;
  const autoArmed = !paired && radio.autoPairEnabled === true;
  const peer = radio.pairedWithDeviceId ?? null;
  const fingerprint = radio.publicKeyFingerprint ?? null;
  const pairedAt = radio.pairedAt ?? null;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        {paired ? (
          <ShieldCheck size={16} className="text-status-success" />
        ) : (
          <ShieldAlert size={16} className="text-status-warning" />
        )}
        <h3 className="text-sm font-semibold text-text-primary">
          {t("pairing.title")}
        </h3>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
              paired
                ? "border-status-success/40 bg-status-success/10 text-status-success"
                : autoArmed
                  ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                  : "border-status-warning/40 bg-status-warning/10 text-status-warning"
            }`}
          >
            {paired
              ? t("pairing.statusPaired", { peer: peer ?? t("pairing.selfDevice") })
              : autoArmed
                ? t("pairing.statusAutoArmed")
                : t("pairing.statusUnpaired")}
          </span>
          {wfbFailoverState === "cloud_relay" ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-500">
              <AlertTriangle size={12} />
              {t("pairing.failover.cloudRelay.title")}
            </span>
          ) : null}
          {wfbFailoverState === "failed" ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-status-error/40 bg-status-error/10 px-2.5 py-1 text-xs text-status-error">
              <AlertTriangle size={12} />
              {t("pairing.failover.failed")}
            </span>
          ) : null}
        </div>
        {fingerprint ? (
          <p className="font-mono text-xs text-text-secondary">
            {t("pairing.fingerprintLabel")}: {fingerprint}
          </p>
        ) : null}
        {pairedAt ? (
          <p className="text-xs text-text-tertiary">
            {t("pairing.pairedAtLabel")}: {pairedAt}
          </p>
        ) : null}
        {!paired && autoArmed ? (
          <p className="text-xs text-text-secondary">
            {t("pairing.armedDescription")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
