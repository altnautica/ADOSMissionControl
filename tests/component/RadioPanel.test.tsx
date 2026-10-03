/**
 * Smoke tests for RadioPanel and TxPowerSlider. Verifies they render
 * without crashing under empty/null state and that the slider's
 * confirm dialog gates apply above the soft floor.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import type { SetTxPowerResult } from "@/lib/api/ground-station/types";

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
  };
});

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: null, apiKey: null, client: null }),
}));

vi.mock("@/stores/ground-station-store", () => ({
  useGroundStationStore: (sel: (s: unknown) => unknown) =>
    sel({
      linkHealth: {
        rssi_dbm: null,
        bitrate_mbps: null,
        fec_rec: 0,
        fec_lost: 0,
        channel: null,
      },
      loadStatus: vi.fn(),
    }),
}));

vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => null,
}));

vi.mock("@/lib/community-api-drones", () => ({
  cmdDroneStatusApi: { listMyCloudStatuses: "stub" },
}));

vi.mock("@/lib/api/ground-station-api", () => ({
  groundStationApiFromAgent: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { RadioPanel } from "@/components/hardware/radio/RadioPanel";
import { TxPowerSlider } from "@/components/hardware/TxPowerSlider";

describe("RadioPanel", () => {
  it("renders the not-supported notice when the agent is not connected", () => {
    renderWithIntl(<RadioPanel />);
    // The empty-state copy renders the "Radio control not supported" string
    // from hardware.radio.notSupported.
    expect(
      screen.getByText("Radio control not supported on this agent"),
    ).toBeDefined();
  });
});

describe("TxPowerSlider", () => {
  function makeApply(): {
    fn: (dbm: number) => Promise<SetTxPowerResult>;
    spy: ReturnType<typeof vi.fn>;
  } {
    const spy = vi.fn(async (dbm: number) => ({
      requested_dbm: dbm,
      effective_dbm: dbm,
      tx_power_max_dbm: 30,
    }));
    return { fn: spy, spy };
  }

  it("renders with a current value and a max ceiling", () => {
    const { fn } = makeApply();
    renderWithIntl(
      <TxPowerSlider
        currentDbm={5}
        maxDbm={20}
        initialValue={5}
        confirmHostname="radio.local"
        onApply={fn}
      />,
    );
    expect(screen.getAllByText("5 dBm").length).toBeGreaterThan(0);
    expect(screen.getByText("Apply")).toBeDefined();
  });

  it("applies directly when the requested value is at or below the soft floor", () => {
    const { fn, spy } = makeApply();
    renderWithIntl(
      <TxPowerSlider
        currentDbm={null}
        maxDbm={15}
        initialValue={5}
        confirmHostname="radio.local"
        onApply={fn}
      />,
    );
    fireEvent.click(screen.getByText("Apply"));
    expect(spy).toHaveBeenCalledWith(5);
  });

  it("does not apply when the requested value is above the soft floor without confirmation", () => {
    const { fn, spy } = makeApply();
    renderWithIntl(
      <TxPowerSlider
        currentDbm={null}
        maxDbm={15}
        initialValue={12}
        confirmHostname="radio.local"
        onApply={fn}
      />,
    );
    fireEvent.click(screen.getByText("Apply"));
    expect(spy).not.toHaveBeenCalled();
  });
});
