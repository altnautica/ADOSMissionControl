/**
 * @license GPL-3.0-only
 *
 * Regression guard for the "removed drone instantly reconnects" bug. A node can
 * be present via several sources at once (a managed FC, a live agent
 * connection, a Convex cloud row, a LAN credential, a node-registry presence
 * entry). forgetNode must clear EVERY source so neither resurrection mechanism
 * fires:
 *   (1) FleetProjectionBridge re-deriving the card from the registry, and
 *   (2) the reactive Convex listMyDrones re-feeding a cloud row whose Convex
 *       document was never deleted.
 *
 * This test forgets a CLOUD-paired node and a LOCAL-paired node and asserts
 * that, after the forget, the projection finds nothing AND the cloud delete +
 * agent unpair were dispatched, so a re-derive / re-feed cannot bring them back.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// local-nodes-store is persisted; bind an in-memory localStorage before import.
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

// The agent unpair POSTs to the network; stub it so the forget is hermetic and
// we can assert it was attempted for the LAN node. The fn is created inside
// vi.hoisted so the vi.mock factory (also hoisted) can close over it.
const { unpairLocalMock } = vi.hoisted(() => ({
  unpairLocalMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/agent/local-pair-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/agent/local-pair-client")
  >();
  return { ...actual, unpairLocal: unpairLocalMock };
});

// drone-metadata-store persists to IndexedDB (unavailable in the test env);
// forgetNode only needs deleteProfile, so stub the store to keep the test
// hermetic and free of async persist noise.
const { deleteProfileMock } = vi.hoisted(() => ({
  deleteProfileMock: vi.fn(),
}));
vi.mock("@/stores/drone-metadata-store", () => ({
  useDroneMetadataStore: {
    getState: () => ({ deleteProfile: deleteProfileMock }),
  },
}));

import { forgetNode } from "../forget-node";
import { nodeIdForDevice } from "../node-id";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { selectFleetDrones } from "@/stores/node-registry/select-fleet-drones";

const LOCAL_DEV = "local-aaaa1111";
const CLOUD_DEV = "cloud-bbbb2222";
const CLOUD_CONVEX_ID = "k57cloudrow";

function seedLocalNode(): void {
  const node: LocalNode = {
    deviceId: LOCAL_DEV,
    name: "Bench Rig",
    hostname: "http://192.168.0.7:8080",
    apiKey: "lan-key",
    profile: "drone",
    pairedAt: 1,
  };
  useLocalNodesStore.setState({ nodes: [node] });
  // LAN presence in the registry (what LocalDroneBridge writes).
  useNodeRegistryStore.getState().upsertPresence(
    nodeIdForDevice(LOCAL_DEV),
    { deviceId: LOCAL_DEV, name: "Bench Rig", lastHeartbeat: Date.now() },
    "local",
  );
}

function seedCloudNode(): void {
  // Pairing-store row (mirrored from listMyDrones) keyed by the Convex doc id.
  usePairingStore.getState().setPairedDrones([
    {
      _id: CLOUD_CONVEX_ID,
      userId: "u1",
      deviceId: CLOUD_DEV,
      name: "Cloud Drone",
      apiKey: "cloud-key",
      pairedAt: 2,
    },
  ]);
  // Cloud presence + a display-status row (what CloudDroneBridge writes).
  useNodeRegistryStore.getState().upsertPresence(
    nodeIdForDevice(CLOUD_DEV),
    {
      deviceId: CLOUD_DEV,
      name: "Cloud Drone",
      cloudDeviceId: CLOUD_DEV,
      lastHeartbeat: Date.now(),
    },
    "cloud",
  );
  useCommandFleetStore
    .getState()
    .upsertCloudStatuses([{ deviceId: CLOUD_DEV, updatedAt: Date.now() }]);
}

/** Re-run the pure projection exactly as FleetProjectionBridge does. */
function projectedIds(): string[] {
  const { nodes } = useNodeRegistryStore.getState();
  const { cloudStatuses } = useCommandFleetStore.getState();
  return selectFleetDrones({ nodes, cloudStatuses, now: Date.now() }).map(
    (d) => d.id,
  );
}

beforeEach(() => {
  unpairLocalMock.mockClear();
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.getState().clear();
  useCommandFleetStore.getState().clear();
  useNodeRegistryStore.getState().clear();
});

describe("forgetNode", () => {
  it("forgets a LOCAL-paired node so the projection no longer derives it", async () => {
    seedLocalNode();
    const nodeId = nodeIdForDevice(LOCAL_DEV);
    expect(projectedIds()).toContain(nodeId);

    expect(await forgetNode(nodeId)).toEqual({ ok: true });

    // LAN credential gone, agent told to unpair, registry presence dropped.
    expect(useLocalNodesStore.getState().nodes).toHaveLength(0);
    expect(unpairLocalMock).toHaveBeenCalledTimes(1);
    expect(useNodeRegistryStore.getState().nodes[nodeId]).toBeUndefined();

    // The resurrector (FleetProjectionBridge re-deriving from the registry)
    // finds nothing: the row does not flash back.
    expect(projectedIds()).not.toContain(nodeId);
    expect(projectedIds()).toHaveLength(0);
  });

  it("forgets a CLOUD-paired node, deleting the Convex row so it cannot re-feed", async () => {
    seedCloudNode();
    const nodeId = nodeIdForDevice(CLOUD_DEV);
    expect(projectedIds()).toContain(nodeId);

    const unpairMutation = vi.fn().mockResolvedValue(undefined);
    const result = await forgetNode(nodeId, {
      convexId: CLOUD_CONVEX_ID,
      unpairMutation,
    });
    expect(result).toEqual({ ok: true });

    // The Convex delete is dispatched with the cloud doc id — this is the bit
    // the old panel path missed for cloud-only drones, which let listMyDrones
    // re-feed the row instantly.
    expect(unpairMutation).toHaveBeenCalledTimes(1);
    expect(unpairMutation).toHaveBeenCalledWith({ droneId: CLOUD_CONVEX_ID });

    // Pairing-store row dropped + registry presence + status row dropped.
    expect(usePairingStore.getState().pairedDrones).toHaveLength(0);
    expect(useNodeRegistryStore.getState().nodes[nodeId]).toBeUndefined();
    expect(
      useCommandFleetStore.getState().cloudStatuses[CLOUD_DEV],
    ).toBeUndefined();

    // No LAN entry existed for this cloud-only node, so the agent unpair is a
    // no-op (the bug was that the OLD path did nothing AT ALL here).
    expect(unpairLocalMock).not.toHaveBeenCalled();

    // Projection finds nothing.
    expect(projectedIds()).not.toContain(nodeId);
  });

  it("does not throw when the node is unknown (idempotent)", async () => {
    await expect(forgetNode(nodeIdForDevice("ghost-9999"))).resolves.toEqual({ ok: true });
    expect(projectedIds()).toHaveLength(0);
  });

  it("keeps a cloud-paired node whole when the cloud unpair fails", async () => {
    seedCloudNode();
    const nodeId = nodeIdForDevice(CLOUD_DEV);

    const result = await forgetNode(nodeId, {
      convexId: CLOUD_CONVEX_ID,
      unpairMutation: vi.fn().mockRejectedValue(new Error("offline")),
    });

    expect(result).toEqual({ ok: false, reason: "cloudFailed", message: "offline" });
    // Nothing was forgotten: the row the cloud would re-feed stays visible.
    expect(usePairingStore.getState().pairedDrones).toHaveLength(1);
    expect(projectedIds()).toContain(nodeId);
  });

  it("keeps a cloud-paired node whole when the cloud is unreachable", async () => {
    seedCloudNode();
    const nodeId = nodeIdForDevice(CLOUD_DEV);

    const result = await forgetNode(nodeId, { convexId: CLOUD_CONVEX_ID, unpairMutation: null });

    expect(result).toEqual({ ok: false, reason: "cloudUnavailable" });
    expect(projectedIds()).toContain(nodeId);
  });
});
