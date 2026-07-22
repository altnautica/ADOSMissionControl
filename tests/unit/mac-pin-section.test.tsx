/**
 * Tests for the node Settings "MAC pinning" page: the adapter list rendered
 * from the node's own status report (with "not reported" and "none tracked"
 * as distinct facts), the per-state labels, and the two config switches
 * writing through the shared config writer.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { MacPinSection } from "@/components/command/settings/MacPinSection";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { MacStability } from "@/lib/agent/feature-types";

const initialCapabilities = useAgentCapabilitiesStore.getState();

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCapabilities, true);
  vi.restoreAllMocks();
});

function renderSection(config: Record<string, unknown> | null = null) {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <MacPinSection
      config={
        config ?? {
          network: { mac_pin: { enabled: true, apply_live_allowed: false } },
        }
      }
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue };
}

describe("MacPinSection adapter list", () => {
  it("distinguishes an unreported list from a reported-empty list", () => {
    // No status report at all: the store default is undefined.
    renderSection();
    expect(
      screen.getByText("This node has not reported adapter stability."),
    ).toBeTruthy();
  });

  it("renders 'none tracked' when the node reports an empty list", () => {
    useAgentCapabilitiesStore.setState({
      macStability: { adapters: [] } as MacStability,
    });
    renderSection();
    expect(
      screen.getByText("The agent reports no adapters that need MAC pinning."),
    ).toBeTruthy();
    expect(
      screen.queryByText("This node has not reported adapter stability."),
    ).toBeNull();
  });

  it("renders the reported adapters with state labels and MACs", () => {
    useAgentCapabilitiesStore.setState({
      macStability: {
        adapters: [
          {
            name: "wlan0",
            vidpid: "a69c:8d81",
            state: "pinned",
            source: "learned",
            pinnedMac: "02:c6:75:83:1a:3e",
            lastSeenMac: "02:c6:75:83:1a:3e",
          },
          {
            name: "wlan1",
            state: "candidate",
            lastSeenMac: "de:ad:be:ef:00:01",
          },
        ],
      } as MacStability,
    });
    renderSection();

    expect(screen.getByText("wlan0")).toBeTruthy();
    expect(screen.getByText("Pinned (next boot)")).toBeTruthy();
    expect(screen.getByText("02:c6:75:83:1a:3e")).toBeTruthy();
    expect(screen.getByText("Learned across boots")).toBeTruthy();

    // Candidate adapter: state label + the confirm-on-node hint naming the
    // interface.
    expect(screen.getByText("Candidate")).toBeTruthy();
    expect(screen.getByText(/ados network mac pin wlan1/)).toBeTruthy();
    // Its current MAC renders since no pinned MAC exists.
    expect(screen.getByText("de:ad:be:ef:00:01")).toBeTruthy();

    // A pinned MAC exists, so the DHCP-reservation hint shows.
    expect(screen.getByText(/DHCP reservation/)).toBeTruthy();
  });

  it("renders a forward-versioned state string raw instead of mislabeling it", () => {
    useAgentCapabilitiesStore.setState({
      macStability: {
        adapters: [
          {
            name: "eth1",
            state: "quarantined" as never,
          },
        ],
      } as MacStability,
    });
    renderSection();
    expect(screen.getByText("quarantined")).toBeTruthy();
  });
});

describe("MacPinSection config switches", () => {
  it("writes the pin-service enable through the shared config writer", async () => {
    const { setValue } = renderSection({
      network: { mac_pin: { enabled: true, apply_live_allowed: false } },
    });
    fireEvent.click(screen.getByText("Automatic MAC pinning"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("network.mac_pin.enabled", "false"),
    );
  });

  it("writes the live re-tag opt-in through the shared config writer", async () => {
    const { setValue } = renderSection({
      network: { mac_pin: { enabled: true, apply_live_allowed: false } },
    });
    fireEvent.click(screen.getByText("Allow live re-tag"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "network.mac_pin.apply_live_allowed",
        "true",
      ),
    );
  });
});
