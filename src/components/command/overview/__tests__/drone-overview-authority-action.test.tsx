/**
 * @module overview/drone-overview-authority-action.test
 * @description Pins the one operator-actionable authority affordance on the
 * drone Overview: the params tile, whose jump-off is a parameter WRITE and
 * therefore leads somewhere no frame can land while this browser holds no
 * publish grant. While that is the missing piece the button obtains the grant
 * instead of navigating, and once control is held it navigates as before.
 *
 * This is also the selected-drone half of the "one grant source" contract. The
 * fleet-row half is pinned in
 * `components/command/nodes/__tests__/control-authority-indicator.test.tsx`;
 * both read `mqtt-control-grant-store`, and a surface that disagreed with the
 * board about whether the operator can command is the defect being closed.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// Several stores under the overview are persisted; bind a deterministic
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
import { DroneOverview } from "../DroneOverview";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import {
  attachGrantBackend,
  useMqttControlGrantStore,
  type GrantBackend,
  type MintedGrant,
} from "@/stores/mqtt-control-grant-store";

const NODE_ID = "node:drone-a";
const DEVICE = "drone-a";

/** A relay-carried drone whose transport reports it may publish. */
function seedRelayDrone() {
  const managed = {
    id: NODE_ID,
    name: "Drone A",
    transport: { type: "mqtt-mavlink", canCommand: true },
  } as unknown as ManagedDrone;
  useDroneManager.setState({
    drones: new Map([[NODE_ID, managed]]),
    selectedDroneId: NODE_ID,
  });
}

function seedGrant() {
  useMqttControlGrantStore.setState({
    principal: "gcs-op-test",
    grant: {
      deviceIds: [DEVICE],
      expiresAt: Date.now() + 60 * 60 * 1000,
      writeConfirmed: true,
      renewalFailed: false,
    },
  });
}

function ctx(): SurfaceContext {
  return {
    droneId: NODE_ID,
    drone: { _id: NODE_ID, deviceId: DEVICE, name: "Drone A" },
    displayName: "Drone A",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: null,
    agentIdentityKnown: false,
    relayReach: null,
    fcLinking: false,
    radioPresent: false,
    visionPresent: false,
    crsfPresent: false,
    role: "drone",
    showLockedTabs: false,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
  } as unknown as SurfaceContext;
}

function renderOverview() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneOverview ctx={ctx()} />
    </NextIntlClientProvider>,
  );
}

const mints: string[] = [];
const backend: GrantBackend = {
  mint: async (): Promise<MintedGrant> => {
    mints.push("mint");
    return {
      principal: "gcs-op-fresh",
      secret: "secret",
      deviceIds: [DEVICE],
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
  },
  revoke: async () => ({ revoked: 0 }),
  confirmWrite: async () => ({ ok: true }),
};

afterEach(() => {
  cleanup();
  mints.length = 0;
  attachGrantBackend(null);
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useMqttControlGrantStore.setState({
    grant: null,
    principal: null,
    minting: false,
    lastError: null,
  });
});

describe("DroneOverview — command-authority action", () => {
  it("offers the mint on a relay drone holding no grant, and takes it", async () => {
    attachGrantBackend(backend);
    seedRelayDrone();
    renderOverview();

    const action = screen.getByText("Request command authority");
    expect(action).toBeTruthy();

    // The tile is the button; clicking anywhere in it must mint rather than
    // navigate to a tab whose every write the broker would refuse.
    action.click();
    await waitFor(() => expect(mints).toHaveLength(1));
    await waitFor(() =>
      expect(useMqttControlGrantStore.getState().principal).toBe("gcs-op-fresh"),
    );
  });

  it("stops offering it once a grant covering this drone is held", () => {
    attachGrantBackend(backend);
    seedGrant();
    seedRelayDrone();
    renderOverview();

    expect(screen.queryByText("Request command authority")).toBeNull();
    expect(screen.queryByText(/Receive only/)).toBeNull();
  });

  it("says nothing about broker authority on a direct link", () => {
    attachGrantBackend(backend);
    const managed = {
      id: NODE_ID,
      name: "Drone A",
      transport: { type: "websocket", canCommand: true },
    } as unknown as ManagedDrone;
    useDroneManager.setState({
      drones: new Map([[NODE_ID, managed]]),
      selectedDroneId: NODE_ID,
    });
    renderOverview();

    // A direct link does not route FC frames through the broker, so a grant
    // prompt here would invent a limit that does not exist.
    expect(screen.queryByText("Request command authority")).toBeNull();
  });
});
