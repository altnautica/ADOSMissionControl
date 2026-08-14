/**
 * @module nodes/control-authority-indicator.test
 * @description Pins the per-node command-authority indicator on the fleet
 * surfaces: a node carried by a relay transport that reports it CANNOT publish
 * flight-controller frames must say so, and a node whose transport can publish
 * (or that has no transport at all, so nothing has been proven either way) must
 * NOT — a warning invented for an undialled node is as dishonest as a healthy
 * dot on a broken one.
 *
 * The indicator is deliberately separate from `nodeStatusLevel`, the shared
 * health-ring vocabulary: these tests assert the row keeps reading LIVE while it
 * carries the receive-only badge, because that combination — alive and
 * uncommandable — is exactly the state that used to be invisible.
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
import { NodeRow, nodeStatusLevel } from "../NodeRow";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

const NODE_ID = "node:drone-a";

function liveDrone(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: NODE_ID,
    userId: "u",
    deviceId: "drone-a",
    name: "Drone A",
    apiKey: "",
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    profile: "drone",
    isLocal: false,
    ...over,
  };
}

/** Seed the drone manager with one managed drone carrying `transport`. */
function seedTransport(transport: { type: string; canCommand: boolean }) {
  const managed = {
    id: NODE_ID,
    name: "Drone A",
    transport,
  } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[NODE_ID, managed]]) });
}

/**
 * Hold a live write grant covering this node. The badge answers from two facts
 * ANDed together — the grant this browser minted, and the transport's own report
 * that the session it dialled is carrying it — so a test that wants silence has
 * to supply both.
 */
function seedGrant(over: { deviceIds?: string[]; writeConfirmed?: boolean } = {}) {
  useMqttControlGrantStore.setState({
    principal: "gcs-op-test",
    grant: {
      deviceIds: over.deviceIds ?? ["drone-a"],
      expiresAt: Date.now() + 60 * 60 * 1000,
      writeConfirmed: over.writeConfirmed ?? true,
      renewalFailed: false,
    },
  });
}

function renderRow(node: FleetNodeEntry) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NodeRow
        node={node}
        selected={false}
        renaming={false}
        renameValue=""
        renameInputRef={{ current: null }}
        onSelect={() => {}}
        onContext={() => {}}
        onRenameChange={() => {}}
        onRenameSubmit={() => {}}
        onRenameCancel={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useCommandFleetStore.getState().clear();
  useNodePersonalizationStore.setState({ byNode: {} });
  useMqttControlGrantStore.setState({
    grant: null,
    principal: null,
    minting: false,
    lastError: null,
  });
});

describe("NodeRow — command-authority indicator", () => {
  it("badges a relay transport that reports it cannot publish", () => {
    seedTransport({ type: "mqtt-mavlink", canCommand: false });
    renderRow(liveDrone());
    expect(screen.getByText("Receive only")).toBeTruthy();
  });

  it("keeps the health ring on LIVE while showing receive-only", () => {
    // The whole point of a separate badge: the node is reachable and healthy,
    // and simultaneously cannot be commanded. Folding authority into the ring
    // would lose one of the two facts.
    seedTransport({ type: "mqtt-mavlink", canCommand: false });
    const node = liveDrone();
    renderRow(node);
    expect(screen.getByText("Receive only")).toBeTruthy();
    expect(nodeStatusLevel(node)).toBe("good");
  });

  it("stays silent when the relay transport CAN publish under a held grant", () => {
    seedGrant();
    seedTransport({ type: "mqtt-mavlink", canCommand: true });
    renderRow(liveDrone());
    expect(screen.queryByText("Receive only")).toBeNull();
  });

  it("badges a relay transport claiming publish after the grant is gone", () => {
    // Revoked, or lapsed and swept: the socket is still open and still claims it
    // may publish, and the broker will now refuse every frame. The transport's
    // claim alone must not carry the badge, or the row would report authority
    // that no longer exists.
    seedTransport({ type: "mqtt-mavlink", canCommand: true });
    renderRow(liveDrone());
    expect(screen.getByText("Receive only")).toBeTruthy();
  });

  it("badges a relay transport whose grant covers a different drone", () => {
    seedGrant({ deviceIds: ["drone-b"] });
    seedTransport({ type: "mqtt-mavlink", canCommand: true });
    renderRow(liveDrone());
    expect(screen.getByText("Receive only")).toBeTruthy();
  });

  it("stays silent on a direct transport", () => {
    seedTransport({ type: "websocket", canCommand: true });
    renderRow(liveDrone());
    expect(screen.queryByText("Receive only")).toBeNull();
  });

  it("claims nothing for a node this browser has no transport for", () => {
    // Nothing has been dialled, so nothing has been proven. A warning here
    // would be a prediction dressed as a measurement.
    renderRow(liveDrone());
    expect(screen.queryByText("Receive only")).toBeNull();
  });
});
