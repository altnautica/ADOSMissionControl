/**
 * Smoke tests for DroneRadioPanel. Verifies it renders the empty-state
 * notice when no radio snapshot is available, and renders live radio
 * stats plus the TX power slider when the per-drone capability store
 * has a populated radio snapshot.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

vi.mock("lucide-react", () => {
  function makeStub(name: string) {
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    }
    StubIcon.displayName = `StubIcon(${name})`;
    return StubIcon;
  }
  return {
    __esModule: true,
    Radio: makeStub("Radio"),
    AlertTriangle: makeStub("AlertTriangle"),
    AlertCircle: makeStub("AlertCircle"),
    Check: makeStub("Check"),
    Loader2: makeStub("Loader2"),
    X: makeStub("X"),
    ChevronLeft: makeStub("ChevronLeft"),
    ChevronRight: makeStub("ChevronRight"),
    ShieldCheck: makeStub("ShieldCheck"),
    ShieldAlert: makeStub("ShieldAlert"),
  };
});

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: null, apiKey: null, client: null }),
}));

vi.mock("@/lib/api/ground-station-api", () => ({
  groundStationApiFromAgent: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { DroneRadioPanel } from "@/components/dashboard/DroneRadioPanel";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initialState = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ ...initialState, radio: null }, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

describe("DroneRadioPanel", () => {
  it("renders the empty-state notice when the radio block is null", () => {
    renderWithIntl(<DroneRadioPanel droneId="drone-1" />);
    expect(
      screen.getByText("Radio control not supported on this agent"),
    ).toBeDefined();
  });

  it("renders live stats and the air-side badge when radio is populated", () => {
    useAgentCapabilitiesStore.setState({
      ...initialState,
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
        rssiDbm: null,
        bitrateKbps: 12000,
        fecRecovered: 3,
        fecLost: 0,
        packetsLost: 0,
        homeChannel: 149,
        band: "u-nii-3",
        regDomain: "US",
        regPosture: "region",
        pinnedRegion: "US",
        regVerified: true,
        monitorActive: true,
        txActive: true,
        peerLink: "linked",
        hopState: "locked",
        snrDb: 25,
        noiseDbm: -92,
        lossPercent: 0.5,
        mcsIndex: 1,
        rxSilentSeconds: null,
        txVideoStalled: null,
        txVideoStallKills: null,
        txVideoRecvqBytes: null,
        acquireState: "locked",
        channelLocked: true,
        reacquireKills: 0,
        rxZombieKills: 0,
        validRxPacketsPerS: 480,
        linkDiag: null,
        packetsAll: null,
        decryptErrors: null,
        adapterChipset: "RTL8812EU",
        adapterInjectionOk: true,
        adapterUsbDegraded: false,
        adapterUsbSpeedMbps: 480,
        phyMuted: false,
        fecK: null,
        fecN: null,
        linkPreset: null,
        adaptiveBitrateEnabled: null,
        recommendedTierIdx: null,
        recommendedTierName: null,
        recommendedBitrateKbps: null,
        paired: true,
        pairedWithDeviceId: "groundnode",
        pairedAt: "2026-05-08T12:00:00Z",
        publicKeyFingerprint: "deadbeefcafefeed",
        autoPairEnabled: false,
      },
    });
    renderWithIntl(<DroneRadioPanel droneId="drone-1" />);
    // Air-side badge from the new droneRadio i18n namespace
    expect(screen.getByText("Air side")).toBeDefined();
    // Topology badge (external 5V)
    expect(screen.getByText("External 5 V")).toBeDefined();
    // Channel + freq column rendered
    expect(screen.getByText("CH 36 (5180 MHz)")).toBeDefined();
    // Bitrate formatted in Mbps
    expect(screen.getByText("12.0 Mbps")).toBeDefined();
    // Adapter chipset pill rendered when injection-capable
    expect(screen.getByText("Radio: RTL8812EU")).toBeDefined();
    // TX power slider should be present (Apply button from shared component)
    expect(screen.getByText("Apply")).toBeDefined();
  });

  it("warns when the selected adapter is not injection-capable", () => {
    useAgentCapabilitiesStore.setState({
      ...initialState,
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
        rssiDbm: null,
        bitrateKbps: 12000,
        fecRecovered: 3,
        fecLost: 0,
        packetsLost: 0,
        homeChannel: 149,
        band: "u-nii-3",
        regDomain: "US",
        regPosture: "region",
        pinnedRegion: "US",
        regVerified: true,
        monitorActive: false,
        txActive: false,
        peerLink: "searching",
        hopState: "idle",
        snrDb: null,
        noiseDbm: null,
        lossPercent: null,
        mcsIndex: null,
        rxSilentSeconds: null,
        txVideoStalled: null,
        txVideoStallKills: null,
        txVideoRecvqBytes: null,
        acquireState: null,
        channelLocked: null,
        reacquireKills: null,
        rxZombieKills: null,
        validRxPacketsPerS: null,
        linkDiag: null,
        packetsAll: null,
        decryptErrors: null,
        adapterChipset: "RTL8812EU",
        adapterInjectionOk: false,
        adapterUsbDegraded: false,
        adapterUsbSpeedMbps: 480,
        phyMuted: false,
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
    renderWithIntl(<DroneRadioPanel droneId="drone-1" />);
    expect(
      screen.getByText("WFB adapter not injection-capable"),
    ).toBeDefined();
  });
});
