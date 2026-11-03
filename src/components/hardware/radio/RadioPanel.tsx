"use client";

/**
 * @module hardware/radio/RadioPanel
 * @description Hardware sub-view body for the WFB-ng radio link.
 * Composes link-health, pairing, TX power, and bench-test cards while
 * owning the polling loops and the pair-flow callbacks.
 * @license GPL-3.0-only
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Radio as RadioIcon } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useArmedOverrideConfirm } from "@/hooks/use-armed-override-confirm";
import type { SetTxPowerResult, VideoConfigResponse } from "@/lib/api/ground-station/types";
import type { LinkPreset } from "@/lib/api/ground-station/wfb";
import { LinkHealthCard } from "./LinkHealthCard";
import { ChannelStateCard } from "./ChannelStateCard";
import { PairingCard } from "./PairingCard";
import { TxPowerCard } from "./TxPowerCard";
import { WfbTuningCard } from "./WfbTuningCard";
import { CalibrateLinkWizard } from "./CalibrateLinkWizard";
import { useLinkHealthPoll } from "./use-link-health-poll";
import { useRadioReadings } from "./use-radio-readings";
import { useRadioPairActions } from "./use-radio-pair-actions";
import { useRadioCalibration } from "./use-radio-calibration";

export function RadioPanel() {
  const t = useTranslations("hardware.radio");

  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const hasAgent = Boolean(agentUrl);

  const wfbFailoverState = useAgentCapabilitiesStore(
    (s) => s.wfbFailoverState,
  );
  const radioStackState = useAgentCapabilitiesStore(
    (s) => s.radioStackState,
  );

  const { withArmedOverride, armedOverrideDialog } = useArmedOverrideConfirm();
  const [calibrateOpen, setCalibrateOpen] = useState(false);

  const { wfbTxPowerDbm, wfbTxReadbackDbm, pollError } = useLinkHealthPoll(agentUrl, apiKey);
  const {
    hostname,
    receiverName,
    receiverRef,
    linkState,
    topology,
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
    adapterChipset,
    adapterInjectionOk,
    adapterUsbDegraded,
    adapterUsbSpeedMbps,
    txPowerDbm,
    txPowerMaxDbm,
    fecK,
    fecN,
    adaptiveBitrateEnabled,
    recommendedTierName,
    acquireState,
    channelLocked,
    reacquireKills,
    rxZombieKills,
    validRxPacketsPerS,
    linkDiag,
    packetsAll,
    decryptErrors,
    homeChannel,
    band,
    regDomain,
    monitorActive,
    txActive,
    peerLink,
    hopState,
    pairedNoVideo,
    showBrownoutWarning,
  } = useRadioReadings(hasAgent, nodeDeviceId, wfbTxPowerDbm);
  const {
    pairStatus,
    bindSession,
    bindBusy,
    unpairBusy,
    retryBusy,
    handleRetryPairStatus,
    handleOpenLocalBind,
    handleUnpair,
    handleRetryLocal,
  } = useRadioPairActions(agentUrl, apiKey, withArmedOverride);
  const { calibrationSweep, calibrationMeasure, calibrationLastGood } = useRadioCalibration(
    agentUrl,
    apiKey,
    receiverRef,
    mcsIndex,
    fecK,
    fecN,
  );

  if (!hasAgent) {
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

  const onApply = async (dbm: number): Promise<SetTxPowerResult> => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) {
      throw new Error("agent not connected");
    }
    return withArmedOverride((force) => api.setTxPower(dbm, { force }));
  };

  // Radio link-tuning callbacks. Each builds the agent API client fresh (the
  // agent URL / key can change) and drives POST /api/video/config; the card
  // owns the success / warning / error toasts. An armed refusal asks the
  // operator before resending with the override.
  const requireApi = () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) throw new Error("agent not connected");
    return api;
  };
  const onApplyPreset = (preset: LinkPreset): Promise<VideoConfigResponse> =>
    withArmedOverride((force) => requireApi().setPreset(preset, { force }));
  const onApplyFec = (k: number, n: number): Promise<VideoConfigResponse> =>
    withArmedOverride((force) => requireApi().setFec(k, n, { force }));
  const onApplyMcs = (mcs: number): Promise<VideoConfigResponse> =>
    withArmedOverride((force) => requireApi().setMcs(mcs, { force }));
  const onToggleAdaptive = (enabled: boolean): Promise<VideoConfigResponse> =>
    withArmedOverride((force) => requireApi().setAdaptive(enabled, { force }));

  return (
    <div className="flex flex-col gap-4">
      <LinkHealthCard
        topology={topology}
        linkState={linkState}
        showBrownoutWarning={showBrownoutWarning}
        pollError={pollError}
        rssiDbm={rssiDbm}
        bitrateMbps={bitrateMbps}
        channel={channel}
        freqMhz={freqMhz}
        bandwidthMhz={bandwidthMhz}
        fecRecovered={fecRecovered}
        fecLost={fecLost}
        driver={driver}
        iface={iface}
        snrDb={snrDb}
        noiseDbm={noiseDbm}
        lossPercent={lossPercent}
        mcsIndex={mcsIndex}
        rxSilentSeconds={rxSilentSeconds}
        txVideoStalled={txVideoStalled}
        txVideoStallKills={txVideoStallKills}
        pairedNoVideo={pairedNoVideo}
        validRxPacketsPerS={validRxPacketsPerS}
        reacquireKills={reacquireKills}
        rxZombieKills={rxZombieKills}
        adapterChipset={adapterChipset}
        adapterInjectionOk={adapterInjectionOk}
        adapterUsbDegraded={adapterUsbDegraded}
        adapterUsbSpeedMbps={adapterUsbSpeedMbps}
        radioStackState={radioStackState}
        linkDiag={linkDiag}
        packetsAll={packetsAll}
        decryptErrors={decryptErrors}
        fecK={fecK}
        fecN={fecN}
        adaptiveBitrateEnabled={adaptiveBitrateEnabled}
        recommendedTierName={recommendedTierName}
      />

      <ChannelStateCard
        homeChannel={homeChannel}
        channel={channel}
        freqMhz={freqMhz}
        band={band}
        regDomain={regDomain}
        monitorActive={monitorActive}
        txActive={txActive}
        peerLink={peerLink}
        hopState={hopState}
        acquireState={acquireState}
        channelLocked={channelLocked}
      />

      <PairingCard
        pairStatus={pairStatus}
        onRetryPairStatus={handleRetryPairStatus}
        bindSession={bindSession}
        bindBusy={bindBusy}
        unpairBusy={unpairBusy}
        onOpenLocalBind={handleOpenLocalBind}
        onUnpair={handleUnpair}
        wfbFailoverState={wfbFailoverState}
        onRetryLocal={handleRetryLocal}
        retryBusy={retryBusy}
      />

      <TxPowerCard
        txPowerDbm={txPowerDbm}
        txPowerReadbackDbm={wfbTxReadbackDbm}
        txPowerMaxDbm={txPowerMaxDbm}
        hostname={hostname}
        onApply={onApply}
      />

      <WfbTuningCard
        fecK={fecK}
        fecN={fecN}
        mcsIndex={mcsIndex}
        adaptiveBitrateEnabled={adaptiveBitrateEnabled}
        recommendedTierName={recommendedTierName}
        onApplyPreset={onApplyPreset}
        onApplyFec={onApplyFec}
        onApplyMcs={onApplyMcs}
        onToggleAdaptive={onToggleAdaptive}
        onCalibrate={() => setCalibrateOpen(true)}
      />

      <CalibrateLinkWizard
        open={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        sweep={calibrationSweep}
        measure={calibrationMeasure}
        lastGood={calibrationLastGood}
        receiverName={receiverName}
      />
      {armedOverrideDialog}
    </div>
  );
}
