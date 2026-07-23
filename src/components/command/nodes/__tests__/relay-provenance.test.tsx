/**
 * @module nodes/relay-provenance.test
 * @description Render tests for the transitive-reach provenance UX: the
 * "Relayed" sidebar badge and the hover card's WFB reach section (which ground
 * node a drone is linked through + the WFB `-p1` RSSI). Honest surfaces: an
 * unverified RSSI reads "unverified", never a confident value (Rule 44).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup } from "@testing-library/react";

// The local-nodes / pairing stores are persisted; bind a deterministic
// in-memory localStorage before the store modules resolve the global.
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

import messages from "../../../../../locales/en.json";
import { NodeBadgeSet } from "../NodeBadgeSet";
import { NodeStatusHoverCard } from "../NodeStatusHoverCard";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const NOW = Date.now();

function relayedDrone(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: "node:drone-a",
    userId: "relayed",
    deviceId: "drone-a",
    name: "Drone A",
    apiKey: "",
    pairedAt: NOW,
    lastSeen: NOW,
    profile: "drone",
    isLocal: false,
    isRelayed: true,
    reachedVia: "node:gs-1",
    ...over,
  };
}

function renderIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useCommandFleetStore.getState().clear();
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
});

describe("NodeBadgeSet — relayed badge", () => {
  it("leads with a Relayed badge on a live relayed-only node", () => {
    renderIntl(
      <NodeBadgeSet node={relayedDrone()} effProfile="drone" max={3} />,
    );
    expect(screen.getByText("Relayed")).toBeTruthy();
  });

  it("shows no Relayed badge on a directly-reached node", () => {
    renderIntl(
      <NodeBadgeSet
        node={relayedDrone({ isRelayed: undefined, reachedVia: undefined })}
        effProfile="drone"
        max={3}
      />,
    );
    expect(screen.queryByText("Relayed")).toBeNull();
  });

  it("suppresses the Relayed badge on an offline node (Rule 44)", () => {
    // A stale pair-time timestamp reads offline; the liveness badge stands alone.
    renderIntl(
      <NodeBadgeSet
        node={relayedDrone({ lastSeen: 1 })}
        effProfile="drone"
        max={3}
      />,
    );
    expect(screen.queryByText("Relayed")).toBeNull();
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});

describe("NodeStatusHoverCard — WFB reach section", () => {
  it("names the ground node the drone is linked through and the WFB RSSI", () => {
    // The ground node is directly paired over the LAN, so its name resolves.
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
    // The funneled status carries the WFB link RSSI the ground node heard.
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "drone-a", peerDeviceId: "gs-1", peerRssiDbm: -51, updatedAt: NOW },
    ]);

    renderIntl(<NodeStatusHoverCard node={relayedDrone()} />);

    expect(screen.getByText("Linked via WFB through Ground A")).toBeTruthy();
    expect(screen.getByText("WFB -51 dBm")).toBeTruthy();
  });

  it("reads the WFB link unverified when no RSSI is known (Rule 44)", () => {
    renderIntl(<NodeStatusHoverCard node={relayedDrone()} />);
    // No status row → no RSSI → honest "unverified", never a fabricated value.
    expect(screen.getByText("WFB link unverified")).toBeTruthy();
    // The hop still renders, falling back to the raw id when the name is unknown.
    expect(screen.getByText(/Linked via WFB through gs-1/)).toBeTruthy();
  });
});
