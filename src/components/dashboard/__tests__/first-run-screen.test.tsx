/**
 * @module dashboard/first-run-screen.test
 * @description The zero-node first run must offer a route forward, not a
 * description of the problem.
 *
 * The previous screen was FC-first: "No Drones Connected", a "Connect flight
 * controller" primary action, and nothing else. It never showed how to install
 * the agent, never showed the agents already on the operator's network, and
 * exposed demo mode nowhere — it was discoverable only by reading package.json.
 *
 * Each `it` below pins one of the three routes forward. They are asserted
 * through rendered copy and real click behaviour, so a route that is present
 * but wired to nothing fails.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

// The mDNS scan itself is the hook's contract, tested where it lives. Here the
// screen is fed a discovery result directly through the store the hook writes.
vi.mock("@/hooks/use-discovered-agents", () => ({
  useDiscoveredAgents: () => {},
}));

import messages from "../../../../locales/en.json";
import { EmptyFleetState } from "../EmptyFleetState";
import { usePairingStore } from "@/stores/pairing-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

function renderFirstRun() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EmptyFleetState />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  usePairingStore.setState({ discoveredAgents: [] });
  usePairDialogStore.getState().closeDialog();
});

describe("first-run screen (zero nodes)", () => {
  it("renders with an empty fleet", () => {
    expect(useLocalNodesStore.getState().nodes).toHaveLength(0);
    renderFirstRun();
    expect(screen.getByText("No nodes yet")).toBeTruthy();
    // No longer flight-controller-first.
    expect(screen.queryByText(/No Drones Connected/)).toBeNull();
  });

  it("route forward 1: the install path, with a copyable one-liner", () => {
    renderFirstRun();
    const install = screen.getByText("First time? Install a new agent");
    expect(install).toBeTruthy();
    fireEvent.click(install);
    expect(
      screen.getByText(/curl -sSL .*install\.sh \| sudo bash/),
    ).toBeTruthy();
  });

  it("route forward 2: a network scan that says so when it finds nothing", () => {
    renderFirstRun();
    expect(
      screen.getByText(/No ADOS agents found on this network yet/),
    ).toBeTruthy();
  });

  it("route forward 2: a found agent is listed and one click starts its pair", () => {
    usePairingStore.setState({
      discoveredAgents: [
        {
          deviceId: "dev-1",
          name: "Testnode",
          board: "Raspberry Pi 5",
          version: "1.0.0",
          pairingCode: "9TW85C",
          mdnsHost: "testnode.local",
          localIp: "192.168.1.50",
        },
      ],
    });
    renderFirstRun();

    // The scan-empty line is replaced by the real result.
    expect(
      screen.queryByText(/No ADOS agents found on this network yet/),
    ).toBeNull();
    expect(screen.getByText("Testnode")).toBeTruthy();

    fireEvent.click(screen.getByText("Testnode"));
    const dialog = usePairDialogStore.getState();
    expect(dialog.open).toBe(true);
    expect(dialog.initialTab).toBe("add");
    // The address handed over is the one that PROVED reachable (the
    // proxy-resolved IP), not the name the agent reports for itself.
    expect(dialog.prefillHost).toBe("192.168.1.50");
  });

  it("route forward 3: demo mode is reachable from the UI", () => {
    // A real document navigation: `isDemoMode()` reads the query string at
    // call time, so a client-side push would leave mounted stores and bridges
    // on the real path while the URL claimed otherwise.
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    renderFirstRun();
    fireEvent.click(screen.getByText("Explore with a simulated fleet"));
    expect(assign).toHaveBeenCalledWith(
      `${window.location.origin}/?demo=true`,
    );
    assign.mockRestore();
  });

  it("still offers pairing and a direct flight controller", () => {
    renderFirstRun();
    fireEvent.click(screen.getByText("Pair a companion computer"));
    expect(usePairDialogStore.getState().open).toBe(true);
    expect(screen.getByText("Connect flight controller")).toBeTruthy();
  });
});
