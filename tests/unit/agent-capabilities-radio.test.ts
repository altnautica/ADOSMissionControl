/**
 * Verifies the agent capabilities store's radio normalizer. The store
 * accepts a forward-permissive payload and falls back to safe defaults
 * for unknown link states or topologies, so an agent extension cannot
 * crash the GCS.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initialState = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

describe("agent-capabilities-store radio", () => {
  it("defaults radio to null and exposes it to selectors", () => {
    expect(useAgentCapabilitiesStore.getState().radio).toBeNull();
  });

  it("accepts a fully-populated radio block from setCapabilities", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({
      tier: 0,
      cameras: [],
      compute: {
        npu_available: false,
        npu_runtime: null,
        npu_tops: 0,
        npu_utilization_pct: 0,
        gpu_available: false,
      },
      vision: useAgentCapabilitiesStore.getState().vision,
      models: useAgentCapabilitiesStore.getState().models,
      features: { enabled: [], active: null },
      radio: {
        state: "connected",
        iface: "wlan1",
        driver: "8812eu",
        channel: 36,
        freqMhz: 5180,
        bandwidthMhz: 20,
        txPowerDbm: 6,
        txPowerMaxDbm: 20,
        topology: "external_5v",
        rssiDbm: -60,
        bitrateKbps: 12000,
        fecRecovered: 3,
        fecLost: 0,
        packetsLost: 0,
      },
    } as unknown as Record<string, unknown>);
    const radio = useAgentCapabilitiesStore.getState().radio;
    expect(radio).not.toBeNull();
    expect(radio?.state).toBe("connected");
    expect(radio?.topology).toBe("external_5v");
    expect(radio?.txPowerDbm).toBe(6);
    expect(radio?.fecRecovered).toBe(3);
  });

  it("falls back to safe defaults for an unknown state and topology", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({
      radio: {
        state: "future_state",
        topology: "future_topology",
        bandwidthMhz: 0,
        txPowerMaxDbm: 0,
        fecRecovered: 0,
        fecLost: 0,
        packetsLost: 0,
        iface: null,
        driver: null,
        channel: null,
        freqMhz: null,
        txPowerDbm: null,
        rssiDbm: null,
        bitrateKbps: null,
      },
    });
    const radio = useAgentCapabilitiesStore.getState().radio;
    expect(radio?.state).toBe("absent");
    expect(radio?.topology).toBe("host_vbus");
  });

  it("returns null when radio is undefined in the payload", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({});
    expect(useAgentCapabilitiesStore.getState().radio).toBeNull();
  });

  it("clears the radio block on store clear()", () => {
    useAgentCapabilitiesStore.setState({
      ...initialState,
      radio: {
        state: "connected",
        iface: null,
        driver: null,
        channel: null,
        freqMhz: null,
        bandwidthMhz: 20,
        txPowerDbm: 5,
        txPowerMaxDbm: 20,
        topology: "host_vbus",
        rssiDbm: null,
        bitrateKbps: null,
        fecRecovered: 0,
        fecLost: 0,
        packetsLost: 0,
        homeChannel: null,
        band: null,
        regDomain: null,
        regPosture: null,
        pinnedRegion: null,
        regVerified: null,
        monitorActive: null,
        txActive: null,
        peerLink: null,
        hopState: null,
        snrDb: null,
        noiseDbm: null,
        lossPercent: null,
        mcsIndex: null,
        mcsLadderCap: null,
        rxSilentSeconds: null,
        txVideoStalled: null,
        txVideoStallKills: null,
        txVideoRecvqBytes: null,
        acquireState: null,
        channelLocked: null,
        rfUnverified: null,
        reacquireKills: null,
        rxZombieKills: null,
        validRxPacketsPerS: null,
        linkDiag: null,
        packetsAll: null,
        decryptErrors: null,
        adapterChipset: null,
        adapterInjectionOk: null,
        adapterUsbDegraded: null,
        adapterUsbSpeedMbps: null,
        phyMuted: null,
        fecK: null,
        fecN: null,
        linkPreset: null,
        adaptiveBitrateEnabled: null,
        recommendedTierIdx: null,
        recommendedTierName: null,
        recommendedBitrateKbps: null,
        paired: false,
        pairedWithDeviceId: null,
        pairedAt: null,
        publicKeyFingerprint: null,
        autoPairEnabled: false,
      },
    });
    useAgentCapabilitiesStore.getState().clear();
    expect(useAgentCapabilitiesStore.getState().radio).toBeNull();
  });
});
