/**
 * Render tests for the board's Reach column: the bearer chip a node is carried
 * over, and how honestly a WFB link's verification shows.
 *
 * A relayed drone is carried over the radio, not "unreachable"; its link reads
 * verified only when the ground node heard a frame, and unverified / down
 * otherwise — never a confident green (Rule 44 / Rule 37). A node reached more
 * than one way shows the direct primary plus a muted WFB provenance chip.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

// local-nodes / pairing stores are persisted; bind an in-memory localStorage.
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
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { ReachCell } from "@/components/command/nodes-view/ReachCell";
import type { NodeReachDescriptor } from "@/lib/nodes/node-reach";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const NOW = Date.now();

afterEach(() => {
  cleanup();
  useCommandFleetStore.getState().clear();
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
});

/** Register a ground node over the LAN so "via <name>" resolves. */
function nameGroundNode() {
  useLocalNodesStore.setState({
    nodes: [
      {
        deviceId: "gs-1",
        name: "Ground A",
        hostname: "http://gs-1.local:8080",
        apiKey: "k",
        profile: "ground-station",
        pairedAt: NOW,
      },
    ],
  });
}

function relayedDrone(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: "node:drone-a",
    userId: "relayed",
    deviceId: "drone-a",
    name: "Drone A",
    apiKey: "",
    pairedAt: NOW,
    profile: "drone",
    isLocal: false,
    isRelayed: true,
    reachedVia: "node:gs-1",
    ...over,
  } as FleetNodeEntry;
}

const relayReach: NodeReachDescriptor = {
  kind: "none",
  commandable: false,
  reportsVehicleAck: false,
  blockedReason: "relay-only",
  sink: null,
};

const lanReach: NodeReachDescriptor = {
  kind: "lan",
  commandable: true,
  reportsVehicleAck: true,
  sink: null,
};

const noneReach: NodeReachDescriptor = {
  kind: "none",
  commandable: false,
  reportsVehicleAck: false,
  blockedReason: "not-paired",
  sink: null,
};

describe("ReachCell — WFB bearer", () => {
  it("shows the WFB bearer via its ground node and the heard RSSI", () => {
    nameGroundNode();
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "drone-a", peerDeviceId: "gs-1", peerRssiDbm: -51, updatedAt: NOW },
    ]);

    const { container } = renderWithIntl(
      <ReachCell node={relayedDrone()} reach={relayReach} liveness="live" />,
    );

    expect(screen.getByText(/via Ground A/)).toBeDefined();
    expect(screen.getByText("-51 dBm")).toBeDefined();
    // A verified link reads green.
    expect(container.querySelector("[title]")!.className).toContain(
      "status-success",
    );
  });

  it("reads unverified with no RSSI when no frame was heard (Rule 44)", () => {
    nameGroundNode();

    const { container } = renderWithIntl(
      <ReachCell node={relayedDrone()} reach={relayReach} liveness="live" />,
    );

    expect(screen.getByText(/via Ground A/)).toBeDefined();
    // No signal → no fabricated dBm, and never green.
    expect(screen.queryByText(/dBm/)).toBeNull();
    const chip = container.querySelector("[title]")!;
    expect(chip.className).toContain("status-warning");
    expect(chip.className).not.toContain("status-success");
  });

  it("reads down and hides the reading on an offline relayed drone", () => {
    nameGroundNode();
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "drone-a", peerDeviceId: "gs-1", peerRssiDbm: -51, updatedAt: NOW },
    ]);

    const { container } = renderWithIntl(
      <ReachCell node={relayedDrone()} reach={relayReach} liveness="offline" />,
    );

    // Down: the last RSSI is not shown as current, and the chip is not green.
    expect(screen.queryByText(/dBm/)).toBeNull();
    expect(container.querySelector("[title]")!.className).not.toContain(
      "status-success",
    );
  });

  it("falls back to a bare WFB label when the ground node is unknown", () => {
    // No LAN entry for gs-1 → the name does not resolve; the chip still renders.
    renderWithIntl(
      <ReachCell node={relayedDrone()} reach={relayReach} liveness="live" />,
    );
    expect(screen.getByText("WFB")).toBeDefined();
    expect(screen.queryByText(/via/)).toBeNull();
  });
});

describe("ReachCell — multi-path node", () => {
  it("shows the direct primary and a muted WFB secondary", () => {
    nameGroundNode();
    const node = relayedDrone({
      isRelayed: undefined,
      isLocal: true,
    });

    renderWithIntl(<ReachCell node={node} reach={lanReach} liveness="live" />);

    // Primary is the direct LAN reach; the WFB path is a secondary provenance chip.
    expect(screen.getByText("Direct · LAN")).toBeDefined();
    expect(screen.getByText(/WFB · via Ground A/)).toBeDefined();
  });

  it("shows no secondary chip on a plain directly-reached node", () => {
    const node = relayedDrone({
      isRelayed: undefined,
      isLocal: true,
      reachedVia: undefined,
    });

    renderWithIntl(<ReachCell node={node} reach={lanReach} liveness="live" />);

    expect(screen.getByText("Direct · LAN")).toBeDefined();
    expect(screen.queryByText(/WFB/)).toBeNull();
  });
});

describe("ReachCell — capability bearers", () => {
  it("reads a genuinely unreachable node as unreachable", () => {
    const node = relayedDrone({ isRelayed: undefined, reachedVia: undefined });
    renderWithIntl(<ReachCell node={node} reach={noneReach} liveness="live" />);
    expect(screen.getByText("Unreachable")).toBeDefined();
  });
});
