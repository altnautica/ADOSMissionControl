"use client";

/**
 * @module hardware/radio/RadioPanel
 * @description Hardware sub-view body for the WFB-ng radio link.
 * Composes link-health, pairing, TX power, and bench-test cards while
 * owning the polling loops and the pair-flow callbacks.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Radio as RadioIcon } from "lucide-react";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useToast } from "@/components/ui/toast";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { cmdDroneStatusApi } from "@/lib/community-api-drones";
import {
  fetchPairStatus,
  setAutoPairOnRig,
  startLocalBind,
  unpairRig,
} from "@/lib/api/radio-pairing";
import type {
  LocalBindSession,
  PairStatusResponse,
  RadioLinkState,
  RadioTopology,
  RadioPeerLink,
  RadioHopState,
  RadioAcquireState,
  SetTxPowerResult,
} from "@/lib/api/ground-station/types";
import {
  BROWNOUT_TX_FLOOR_DBM,
  DEFAULT_TX_MAX_DBM,
  PAIR_POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
} from "./constants";
import { pickRadioFromCloud, pickReceiverFromCloud } from "./cloud-radio";
import { LinkHealthCard } from "./LinkHealthCard";
import { ChannelStateCard } from "./ChannelStateCard";
import { PairingCard } from "./PairingCard";
import { TxPowerCard } from "./TxPowerCard";
import { WfbTuningCard } from "./WfbTuningCard";
import { CalibrateLinkWizard } from "./CalibrateLinkWizard";
import { BenchTestCard } from "./BenchTestCard";
import type { LinkPreset } from "@/lib/api/ground-station/wfb";
import type { VideoConfigResponse } from "@/lib/api/ground-station/types";
import type { CalMeasurement, CalTrio } from "@/lib/api/ground-station/calibration";

export function RadioPanel() {
  const t = useTranslations("hardware.radio");

  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const hasAgent = Boolean(agentUrl);

  const linkHealth = useGroundStationStore((s) => s.linkHealth);
  const loadStatus = useGroundStationStore((s) => s.loadStatus);

  const [wfbTxPowerDbm, setWfbTxPowerDbm] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatusResponse | null>(null);
  const [bindSession, setBindSession] = useState<LocalBindSession | null>(null);
  const [bindBusy, setBindBusy] = useState(false);
  const [unpairBusy, setUnpairBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);

  const wfbFailoverState = useAgentCapabilitiesStore(
    (s) => s.wfbFailoverState,
  );
  const radioStackState = useAgentCapabilitiesStore(
    (s) => s.radioStackState,
  );

  const { toast } = useToast();

  const cloudStatuses = useConvexSkipQuery(cmdDroneStatusApi.listMyCloudStatuses, {
    enabled: hasAgent,
  });
  const { radio: cloudRadio, hostname } = useMemo(
    () => pickRadioFromCloud(cloudStatuses),
    [cloudStatuses],
  );

  // Calibration measurement source: the fleet node that is RECEIVING a peer's
  // downlink (reports a valid decode rate). The sweep runs on the connected
  // (transmit) agent; the score reads this receiver's decode-side stats. A ref
  // tracks the latest snapshot so the calibration loop reads fresh values
  // between heartbeats without re-rendering the wizard.
  const { radio: receiverRadio, hostname: receiverName } = useMemo(
    () => pickReceiverFromCloud(cloudStatuses),
    [cloudStatuses],
  );
  const receiverRadioRef = useRef(receiverRadio);
  receiverRadioRef.current = receiverRadio;
  const [calibrateOpen, setCalibrateOpen] = useState(false);

  // Effective values: prefer the cloud `radio` block (authoritative
  // air-side snapshot), fall back to local link_health and the WFB
  // config endpoint.
  const linkState: RadioLinkState = cloudRadio?.state
    ? (cloudRadio.state as RadioLinkState)
    : linkHealth.rssi_dbm != null
      ? "connected"
      : "disconnected";
  const topology: RadioTopology = cloudRadio?.topology
    ? (cloudRadio.topology as RadioTopology)
    : "host_vbus";
  const rssiDbm = cloudRadio?.rssiDbm ?? linkHealth.rssi_dbm;
  const bitrateKbps = cloudRadio?.bitrateKbps;
  const bitrateMbps =
    bitrateKbps != null
      ? bitrateKbps / 1000
      : linkHealth.bitrate_mbps;
  const channel = cloudRadio?.channel ?? linkHealth.channel;
  const freqMhz = cloudRadio?.freqMhz ?? null;
  const bandwidthMhz = cloudRadio?.bandwidthMhz ?? null;
  const fecRecovered = cloudRadio?.fecRecovered ?? linkHealth.fec_rec;
  const fecLost = cloudRadio?.fecLost ?? linkHealth.fec_lost;
  const driver = cloudRadio?.driver ?? null;
  const iface = cloudRadio?.iface ?? null;
  const snrDb = cloudRadio?.snrDb ?? null;
  const noiseDbm = cloudRadio?.noiseDbm ?? null;
  const lossPercent = cloudRadio?.lossPercent ?? null;
  const mcsIndex = cloudRadio?.mcsIndex ?? null;
  const rxSilentSeconds = cloudRadio?.rxSilentSeconds ?? null;
  const txVideoStalled = cloudRadio?.txVideoStalled ?? null;
  const txVideoStallKills = cloudRadio?.txVideoStallKills ?? null;
  // Selected WFB adapter surface. adapterInjectionOk === false means the
  // agent found no injection-capable adapter and refuses to transmit.
  const adapterChipset = cloudRadio?.adapterChipset ?? null;
  const adapterInjectionOk = cloudRadio?.adapterInjectionOk ?? null;
  const adapterUsbDegraded = cloudRadio?.adapterUsbDegraded ?? null;
  const adapterUsbSpeedMbps = cloudRadio?.adapterUsbSpeedMbps ?? null;
  const txPowerDbm = cloudRadio?.txPowerDbm ?? wfbTxPowerDbm;
  const txPowerMaxDbm = cloudRadio?.txPowerMaxDbm ?? DEFAULT_TX_MAX_DBM;

  // Live radio tuning surface (the running trio + adaptive state). Read-only
  // display values; the WfbTuningCard drives changes via onApply*.
  const fecK = cloudRadio?.fecK ?? null;
  const fecN = cloudRadio?.fecN ?? null;
  const adaptiveBitrateEnabled = cloudRadio?.adaptiveBitrateEnabled ?? null;
  const recommendedTierName = cloudRadio?.recommendedTierName ?? null;

  // Ground receive acquisition surface. acquireState / channelLocked
  // describe the channel-acquirer; reacquireKills counts destructive
  // ground wfb_rx restarts (a climbing value = thrashing receive link);
  // validRxPacketsPerS is the per-second valid WFB decode rate.
  const acquireState: RadioAcquireState | null =
    cloudRadio?.acquireState ?? null;
  const channelLocked = cloudRadio?.channelLocked ?? null;
  const reacquireKills = cloudRadio?.reacquireKills ?? null;
  const rxZombieKills = cloudRadio?.rxZombieKills ?? null;
  const validRxPacketsPerS = cloudRadio?.validRxPacketsPerS ?? null;

  // WFB link-diagnosis verdict + received-frame counters. Null when the
  // agent doesn't report them (older agents) so the card skips the chip
  // and the counter rows rather than fabricating a reading.
  const linkDiag = cloudRadio?.linkDiag ?? null;
  const packetsAll = cloudRadio?.packetsAll ?? null;
  const decryptErrors = cloudRadio?.decryptErrors ?? null;

  // Channel rendezvous + hop surface. Read-only: the agent owns
  // channel / band / reg-domain config and the hop supervisor decides
  // when to move. The card stays hidden when the agent reports none of
  // these (older agents).
  const homeChannel = cloudRadio?.homeChannel ?? null;
  const band = cloudRadio?.band ?? null;
  const regDomain = cloudRadio?.regDomain ?? null;
  const monitorActive = cloudRadio?.monitorActive ?? null;
  const txActive = cloudRadio?.txActive ?? null;
  const peerLink: RadioPeerLink | null = cloudRadio?.peerLink ?? null;
  const hopState: RadioHopState | null = cloudRadio?.hopState ?? null;
  const paired = cloudRadio?.paired ?? false;

  // "Paired — no video": the control link is up (paired and a peer has
  // been heard) but no valid WFB packets are decoding on the ground.
  // This is the operator's cue that the radio handshake succeeded yet
  // the video downlink isn't flowing. A non-zero decode rate means the
  // receive link is genuinely live.
  const pairedNoVideo =
    paired &&
    (peerLink === "linked" || acquireState === "locked") &&
    validRxPacketsPerS != null &&
    validRxPacketsPerS <= 0;

  // Brownout: VBUS topology + above 12 dBm. Agent firmware caps the
  // slider in hardware; this is just an informational pill.
  const showBrownoutWarning =
    topology === "host_vbus" &&
    txPowerDbm != null &&
    txPowerDbm > BROWNOUT_TX_FLOOR_DBM;

  useEffect(() => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Self-scheduling poll: the next tick is only armed once this one settles.
    // The link-health poll does two sequential round-trips (getStatus +
    // getWfb), so on a slow agent link a fixed-interval timer would queue
    // overlapping requests onto the agent. Re-arming in the finally guarantees
    // at most one in-flight poll at a time.
    const poll = async () => {
      if (cancelled || (typeof document !== "undefined" && document.hidden)) {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      try {
        const status = await api.getStatus();
        if (cancelled) return;
        loadStatus(
          {
            paired_drone: status.paired_drone ?? null,
            profile: status.profile ?? "unconfigured",
            uplink_active: status.uplink_active ?? null,
          },
          status.link_health,
        );
        try {
          const wfb = await api.getWfb();
          if (cancelled) return;
          setWfbTxPowerDbm(
            typeof wfb.tx_power_dbm === "number" ? wfb.tx_power_dbm : null,
          );
        } catch {
          // WFB endpoint missing on this agent profile is fine.
        }
        setPollError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "poll failed";
        setPollError(msg);
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentUrl, apiKey, loadStatus]);

  // Pair-state poller. Cheap (single GET against /api/wfb/pair); the
  // 2 Hz cadence is fine and matches the link-health poll above. Same
  // self-scheduling shape so a stalled request never stacks the next tick.
  useEffect(() => {
    if (!agentUrl) return;
    const ctx = { baseUrl: agentUrl, apiKey };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled || (typeof document !== "undefined" && document.hidden)) {
        if (!cancelled) timer = setTimeout(poll, PAIR_POLL_INTERVAL_MS);
        return;
      }
      try {
        const status = await fetchPairStatus(ctx);
        if (!cancelled) setPairStatus(status);
      } catch {
        // Older agents lack the /api/wfb/pair endpoint; treat as
        // "unpaired, not auto-pairing" without spamming a toast.
        if (!cancelled) setPairStatus(null);
      } finally {
        if (!cancelled) timer = setTimeout(poll, PAIR_POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentUrl, apiKey]);

  // Local-bind action. Synchronous: the agent runs the upstream
  // protocol to completion (≤60s) and returns the terminal session.
  const handleOpenLocalBind = useCallback(async () => {
    if (bindBusy) return;
    if (!agentUrl) return;
    setBindBusy(true);
    setBindSession({
      session_id: "pending",
      role: "gs",
      state: "opening_tunnel",
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      fingerprint: null,
      peer_device_id: null,
      source: "operator",
    });
    toast(t("pairing.progressOpening"), "info");
    try {
      const session = await startLocalBind({ baseUrl: agentUrl, apiKey }, {});
      setBindSession(session);
      if (session.state === "paired") {
        toast(t("pairing.progressDone"), "success");
        // Force a fresh pair-status read so the UI flips immediately.
        try {
          const status = await fetchPairStatus({ baseUrl: agentUrl, apiKey });
          setPairStatus(status);
        } catch {
          /* swallow */
        }
      } else {
        toast(
          t("pairing.errorAgentError", {
            message: session.error ?? session.state,
          }),
          "error",
        );
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      setBindSession((prev) =>
        prev ? { ...prev, state: "failed", error: msg } : null,
      );
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setBindBusy(false);
    }
  }, [agentUrl, apiKey, bindBusy, toast, t]);

  const handleUnpair = useCallback(async () => {
    if (unpairBusy) return;
    if (!agentUrl) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(t("pairing.confirmUnpairBody"));
      if (!confirmed) return;
    }
    setUnpairBusy(true);
    try {
      await unpairRig({ baseUrl: agentUrl, apiKey });
      toast(t("pairing.statusUnpaired"), "info");
      try {
        const status = await fetchPairStatus({ baseUrl: agentUrl, apiKey });
        setPairStatus(status);
      } catch {
        /* swallow */
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setUnpairBusy(false);
    }
  }, [agentUrl, apiKey, unpairBusy, toast, t]);

  // Re-arm the auto-pair supervisor on the rig when the heartbeat
  // says the local link has failed over to the cloud relay path. The
  // supervisor turns on local pairing again, and the next heartbeat
  // tick should clear the cloud_relay state.
  const handleRetryLocal = useCallback(async () => {
    if (retryBusy) return;
    if (!agentUrl) return;
    setRetryBusy(true);
    try {
      await setAutoPairOnRig({ baseUrl: agentUrl, apiKey }, true);
      toast(t("pairing.failover.retrySuccess"), "success");
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setRetryBusy(false);
    }
  }, [agentUrl, apiKey, retryBusy, toast, t]);

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
    return api.setTxPower(dbm);
  };

  // Radio link-tuning callbacks. Each builds the agent API client fresh (the
  // agent URL / key can change) and drives POST /api/video/config; the card
  // owns the success / warning / error toasts.
  const requireApi = () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) throw new Error("agent not connected");
    return api;
  };
  const onApplyPreset = (preset: LinkPreset): Promise<VideoConfigResponse> =>
    requireApi().setPreset(preset);
  const onApplyFec = (k: number, n: number): Promise<VideoConfigResponse> =>
    requireApi().setFec(k, n);
  const onApplyMcs = (mcs: number): Promise<VideoConfigResponse> =>
    requireApi().setMcs(mcs);
  const onToggleAdaptive = (enabled: boolean): Promise<VideoConfigResponse> =>
    requireApi().setAdaptive(enabled);

  // Calibration: sweep the connected (transmit) agent's trio, measure the
  // receiver node's decode-side stats. setFec + setMcs are applied in sequence
  // (the agent persists each); the wizard's settle window covers the respawns.
  const calibrationSweep = async (trio: CalTrio): Promise<void> => {
    const api = requireApi();
    await api.setFec(trio.fecK, trio.fecN);
    await api.setMcs(trio.mcs);
  };
  const calibrationMeasure = (): CalMeasurement => {
    const r = receiverRadioRef.current;
    return {
      lossPercent: r?.lossPercent ?? null,
      // The receiver's unrecoverable-block counter is the decode-side fail
      // signal: scored from confirmed reception, never the transmitter's
      // own tx_bytes (an advancing TX counter is not proof of a live link).
      fecFailed: r?.fecLost ?? null,
      validRxPacketsPerS: r?.validRxPacketsPerS ?? null,
      bitrateKbps: r?.bitrateKbps ?? null,
      rssiDbm: r?.rssiDbm ?? null,
    };
  };
  const calibrationLastGood: CalTrio | null =
    mcsIndex != null && fecK != null && fecN != null
      ? { mcs: mcsIndex, fecK, fecN }
      : null;

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

      <BenchTestCard />
    </div>
  );
}
