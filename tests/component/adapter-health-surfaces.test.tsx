/**
 * The ground-station surfaces that name a radio adapter's self-reported
 * health.
 *
 * A ground station's receive adapter fails the same ways an air-side one does,
 * and every quality figure above it keeps reading plausibly when it fails. So
 * these tests pin the two cases a surface could get wrong: a reported fault has
 * to be visible, and an absent report has to read as unreported rather than
 * quietly borrowing the healthy styling. The radio blocks are built through the
 * real normalizer so the wire shape is exercised, not a hand-written stand-in.
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
    RefreshCw: makeStub("RefreshCw"),
    AlertTriangle: makeStub("AlertTriangle"),
    ShieldAlert: makeStub("ShieldAlert"),
  };
});

vi.mock("@/stores/ground-station-store", () => ({
  useGroundStationStore: (sel: (s: unknown) => unknown) =>
    sel({
      linkHealth: {
        rssi_dbm: -52,
        bitrate_mbps: 6.6,
        fec_rec: 0,
        fec_lost: 0,
        channel: 149,
      },
    }),
}));

vi.mock("@/stores/radio-network-health-store", () => ({
  useRadioNetworkHealthStore: (sel: (s: unknown) => unknown) =>
    sel({
      recentEvents: [],
      wifiReassocRecent: false,
      available: true,
      loading: false,
      refresh: vi.fn(async () => {}),
      clear: vi.fn(),
    }),
}));

import { GroundStationLinkCard } from "@/components/command/shared/GroundStationLinkCard";
import { RadioNetworkHealthPanel } from "@/components/command/system/RadioNetworkHealthPanel";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";

const initialState = useAgentCapabilitiesStore.getState();

/** A ground-station receive snapshot with the adapter fields under test. */
function groundRadio(fields: Record<string, unknown>) {
  return normalizeRadio({
    state: "connected",
    iface: "wlan1",
    driver: "8812eu",
    channel: 149,
    freqMhz: 5745,
    validRxPacketsPerS: 327,
    ...fields,
  });
}

function setRadio(fields: Record<string, unknown>) {
  useAgentCapabilitiesStore.setState(
    { ...initialState, radio: groundRadio(fields) },
    true,
  );
}

/** The className of the value cell rendered next to a `<dt>` / tile label. */
function valueClassFor(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.nextElementSibling;
  expect(dd).not.toBeNull();
  return dd!.className;
}

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ ...initialState, radio: null }, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

describe("GroundStationLinkCard adapter health", () => {
  it("names a degraded receive adapter and its enumerated speed", () => {
    setRadio({ adapterUsbDegraded: true, adapterUsbSpeedMbps: 12 });
    renderWithIntl(<GroundStationLinkCard />);

    expect(screen.getByText("Degraded (12 Mbps)")).toBeDefined();
    expect(valueClassFor("USB link")).toContain("text-status-error");
  });

  it("names a healthy receive adapter with its speed", () => {
    setRadio({ adapterUsbDegraded: false, adapterUsbSpeedMbps: 480 });
    renderWithIntl(<GroundStationLinkCard />);

    expect(screen.getByText("OK (480 Mbps)")).toBeDefined();
    expect(valueClassFor("USB link")).toContain("text-status-success");
  });

  it("renders an unreported USB link as unreported, not as healthy", () => {
    setRadio({ adapterUsbSpeedMbps: 480 });
    renderWithIntl(<GroundStationLinkCard />);

    expect(valueClassFor("USB link")).not.toContain("text-status-success");
    expect(screen.queryByText("OK (480 Mbps)")).toBeNull();
    // The slot still renders: a missing reading is the operator's cue that the
    // node never reported one, which an omitted row would hide.
    expect(valueClassFor("USB link")).toContain("text-text-secondary");
  });

  it("names an adapter that cannot inject", () => {
    setRadio({ adapterChipset: "RTL8812EU", adapterInjectionOk: false });
    renderWithIntl(<GroundStationLinkCard />);

    expect(screen.getByText("RTL8812EU — cannot inject")).toBeDefined();
    expect(valueClassFor("Adapter")).toContain("text-status-error");
  });

  it("does not read a chipset name as an injection verdict", () => {
    setRadio({ adapterChipset: "RTL8812EU" });
    renderWithIntl(<GroundStationLinkCard />);

    expect(
      screen.getByText("RTL8812EU — injection not reported"),
    ).toBeDefined();
    expect(valueClassFor("Adapter")).not.toContain("text-status-success");
  });
});

describe("RadioNetworkHealthPanel adapter health", () => {
  it("names a degraded USB link on a ground-station receive adapter", () => {
    setRadio({
      adapterChipset: "RTL8812EU",
      adapterInjectionOk: true,
      adapterUsbDegraded: true,
      adapterUsbSpeedMbps: 12,
    });
    renderWithIntl(<RadioNetworkHealthPanel />);

    expect(screen.getByText("Radio USB link")).toBeDefined();
    expect(screen.getByText("Degraded (12 Mbps)")).toBeDefined();
    expect(valueClassFor("Radio USB link")).toContain("text-status-error");
  });

  it("renders an unreported USB link as unreported", () => {
    setRadio({ adapterChipset: "RTL8812EU", adapterInjectionOk: true });
    renderWithIntl(<RadioNetworkHealthPanel />);

    expect(screen.getByText("Not reported")).toBeDefined();
    expect(valueClassFor("Radio USB link")).not.toContain(
      "text-status-success",
    );
  });

  it("does not colour the adapter green off an unreported injection verdict", () => {
    // The panel used to derive a green adapter from the presence of a chipset
    // name, so a node that reported no verdict looked confirmed working.
    setRadio({ adapterChipset: "RTL8812EU" });
    renderWithIntl(<RadioNetworkHealthPanel />);

    expect(valueClassFor("Radio adapter")).not.toContain("text-status-success");
    expect(
      screen.getByText("RTL8812EU — injection not reported"),
    ).toBeDefined();
  });

  it("colours the adapter green only on a reported injection verdict", () => {
    setRadio({ adapterChipset: "RTL8812EU", adapterInjectionOk: true });
    renderWithIntl(<RadioNetworkHealthPanel />);

    expect(screen.getByText("RTL8812EU — injection OK")).toBeDefined();
    expect(valueClassFor("Radio adapter")).toContain("text-status-success");
  });

  it("names an adapter that cannot inject", () => {
    setRadio({ adapterChipset: "RTL8812EU", adapterInjectionOk: false });
    renderWithIntl(<RadioNetworkHealthPanel />);

    expect(screen.getByText("RTL8812EU — cannot inject")).toBeDefined();
    expect(valueClassFor("Radio adapter")).toContain("text-status-error");
  });
});
