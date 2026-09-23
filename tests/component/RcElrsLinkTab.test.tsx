/**
 * Tests for RcElrsLinkTab. Verifies the CRSF / ExpressLRS control-lane tab
 * renders each lane state with the right badge, keeps rf_unverified distinct
 * from connected, surfaces the MAVLink-over-ELRS command-down gate honestly,
 * reports an unavailable PIC arbiter plainly, and falls back to an explicit
 * empty state when no lane is advertised (rather than a blank body). Also
 * confirms the tab reads the per-node crsf snapshot from the capability store.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    RadioTower: makeStub("RadioTower"),
    ShieldAlert: makeStub("ShieldAlert"),
    AlertTriangle: makeStub("AlertTriangle"),
    Gamepad2: makeStub("Gamepad2"),
    ChevronDown: makeStub("ChevronDown"),
    ChevronUp: makeStub("ChevronUp"),
  };
});

import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { CrsfState } from "@/lib/api/ground-station/types";

function makeCrsf(over: Partial<CrsfState> = {}): CrsfState {
  return {
    state: "link_ok",
    rssiDbm: -70,
    lqUplink: 96,
    lqDownlink: 94,
    snrDb: 9,
    band: "2.4",
    packetRateHz: 150,
    txPowerMw: 100,
    txFramesPerS: 150,
    rxFramesPerS: 50,
    rfUnverified: false,
    flyable: true,
    mode: "crsf_rc",
    fcCommandDownGated: null,
    channelSource: "hid",
    pic: "ground",
    relayRole: null,
    ...over,
  };
}

const initialState = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ ...initialState, crsf: null }, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

describe("RcElrsLinkTab lane states", () => {
  it("renders the connected badge for a link_ok lane", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf({ state: "link_ok" })} />);
    expect(screen.getByText("Connected")).toBeDefined();
    // Live stats render (RSSI value formatted).
    expect(screen.getByText("-70 dBm")).toBeDefined();
  });

  it("renders the degraded badge for a degraded lane", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf({ state: "degraded" })} />);
    expect(screen.getByText("Degraded")).toBeDefined();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("renders rf_unverified as its own distinct badge, never connected", () => {
    renderWithIntl(
      <RcElrsLinkTab
        crsf={makeCrsf({ state: "rf_unverified", rfUnverified: true })}
      />,
    );
    expect(screen.getByText("Transmit unverified")).toBeDefined();
    // Not collapsed to connected or degraded.
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByText("Degraded")).toBeNull();
    // The caveat explaining the unproven transmit is visible, not hover-gated.
    expect(
      screen.getByText(/no reception from a peer has been confirmed/i),
    ).toBeDefined();
  });

  it("surfaces the transmit-unverified verdict even when the coarse state differs", () => {
    // A lane that reports "ready" but carries a true rf_unverified verdict still
    // shows the unverified chip, so the transmit-unproven fact is never lost.
    renderWithIntl(
      <RcElrsLinkTab crsf={makeCrsf({ state: "ready", rfUnverified: true })} />,
    );
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Transmit unverified")).toBeDefined();
  });

  it("renders the disabled badge for a disabled lane", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf({ state: "disabled" })} />);
    expect(screen.getByText("Disabled")).toBeDefined();
  });

  it("renders an explicit empty state (not a blank body) when no lane is advertised", () => {
    renderWithIntl(<RcElrsLinkTab crsf={null} />);
    expect(screen.getByText("RC / ELRS lane not configured")).toBeDefined();
  });
});

describe("RcElrsLinkTab command-down gate", () => {
  it("shows the gated-command note so an operator is not misled that commands get through", () => {
    renderWithIntl(
      <RcElrsLinkTab
        crsf={makeCrsf({
          state: "link_ok",
          mode: "mavlink",
          fcCommandDownGated: true,
        })}
      />,
    );
    expect(screen.getByText("Command path gated")).toBeDefined();
    expect(
      screen.getByText(/Commands are not reaching the flight controller/i),
    ).toBeDefined();
  });

  it("does not show the gated-command note when the command path is not gated", () => {
    renderWithIntl(
      <RcElrsLinkTab
        crsf={makeCrsf({ mode: "mavlink", fcCommandDownGated: false })}
      />,
    );
    expect(screen.queryByText("Command path gated")).toBeNull();
  });

  it("does not show the gated-command note when there is no verdict (null)", () => {
    renderWithIntl(
      <RcElrsLinkTab crsf={makeCrsf({ fcCommandDownGated: null })} />,
    );
    expect(screen.queryByText("Command path gated")).toBeNull();
  });
});

describe("RcElrsLinkTab honest field reads", () => {
  it("reports an unavailable PIC arbiter plainly", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf({ pic: "unavailable" })} />);
    expect(screen.getByText("Arbiter unavailable")).toBeDefined();
  });

  it("reads a dropped PIC (heartbeat projection) as not reported, never a fake holder", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf({ pic: null })} />);
    expect(screen.getByText("Not reported")).toBeDefined();
  });

  it("shows an unmeasured value as a placeholder, never a fabricated zero", () => {
    renderWithIntl(
      <RcElrsLinkTab
        crsf={makeCrsf({ rssiDbm: null, txPowerMw: null, band: null })}
      />,
    );
    // No fabricated "0 dBm" / "0 mW" for the missing values.
    expect(screen.queryByText("0 dBm")).toBeNull();
    expect(screen.queryByText("0 mW")).toBeNull();
  });

  it("always shows the RF-compliance reminder where TX power / band are shown", () => {
    renderWithIntl(<RcElrsLinkTab crsf={makeCrsf()} />);
    expect(
      screen.getByText(/responsible for RF compliance in your operating region/i),
    ).toBeDefined();
  });
});

describe("RcElrsLinkTab per-node reading", () => {
  function seedNode(crsf: CrsfState | null, ageMs: number) {
    const snapshot = {
      ...initialState,
      crsf,
      receivedAt: Date.now() - ageMs,
    };
    const { focusedDeviceId: _f, byDevice: _b, ...slice } = snapshot;
    useAgentCapabilitiesStore.setState({
      // The focused slice describes another node with a healthy lane; the tab
      // must not borrow it.
      crsf: makeCrsf({ state: "link_ok", rssiDbm: -40 }),
      byDevice: { "gs-1": slice },
    });
  }

  it("reads the rendered node's own snapshot, not the focused slice", () => {
    seedNode(makeCrsf({ state: "degraded", rssiDbm: -95 }), 1_000);
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-1" />);
    expect(screen.getByText("-95 dBm")).toBeDefined();
    expect(screen.queryByText("-40 dBm")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks a reading from a node that stopped answering as not current", () => {
    seedNode(makeCrsf({ state: "link_ok" }), 50_000);
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-1" />);
    expect(screen.getByRole("status").textContent).toMatch(
      /Last reading 50s ago.*not current/,
    );
  });

  it("says the node is not answering instead of 'not configured' when the last reading is old", () => {
    seedNode(null, 120_000);
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-1" />);
    expect(screen.getByText("Node not answering")).toBeDefined();
    expect(screen.queryByText("RC / ELRS lane not configured")).toBeNull();
  });

  it("says 'not read' for a node never heard from", () => {
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-unknown" />);
    expect(screen.getByText("No reading from this node yet")).toBeDefined();
    expect(screen.queryByText("RC / ELRS lane not configured")).toBeNull();
  });

  it("shows the empty state for a fresh reading with no lane", () => {
    seedNode(null, 1_000);
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-1" />);
    expect(screen.getByText("RC / ELRS lane not configured")).toBeDefined();
  });

  it("treats a reading just written by a node payload as current", () => {
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ crsf: makeCrsf({ rssiDbm: -77 }) }, "gs-2");
    renderWithIntl(<RcElrsLinkTab nodeDeviceId="gs-2" />);
    expect(screen.getByText("-77 dBm")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
