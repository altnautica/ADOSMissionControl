/**
 * @license GPL-3.0-only
 *
 * Regression guard for the "paired but offline, no heartbeat" bug: the
 * post-pair handoff forwards only the deviceId (onPaired(deviceId, "", "")),
 * so the connect path must read the hostname + apiKey from the local-nodes
 * store, NOT from caller args. Calling connect("","") here left the focused
 * agent store empty and the detail panel permanently "offline".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Persisted local-nodes-store: bind an in-memory localStorage before import.
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

import { connectLocalNode } from "../node-click-handler";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const HOST = "http://192.168.0.5:8080";
const KEY = "real-key";
const DEV = "5b67bb47";

function seed(node: Partial<LocalNode>): void {
  useLocalNodesStore.setState({
    nodes: [
      {
        deviceId: DEV,
        name: "Rig",
        hostname: HOST,
        apiKey: KEY,
        profile: "drone",
        pairedAt: 1,
        ...node,
      } as LocalNode,
    ],
  });
}

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
});

describe("connectLocalNode", () => {
  it("reports the settled LAN connect, not the moment it started", async () => {
    seed({});
    useAgentConnectionStore.setState({ connected: false, stalePairing: null });
    // setState copies whatever `connect` is current onto the new state, so the
    // real one is put back explicitly at the end.
    const realConnect = useAgentConnectionStore.getState().connect;
    const settled = Promise.withResolvers<void>();
    vi.spyOn(useAgentConnectionStore.getState(), "connect").mockImplementation(async () => {
      await settled.promise;
      useAgentConnectionStore.setState({ connected: true });
    });
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(() => {});

    const pending = connectLocalNode(DEV, { onFocusAgent: () => {} });
    settled.resolve();
    await expect(pending).resolves.toBe("connected");

    vi.restoreAllMocks();
    useAgentConnectionStore.setState({ connect: realConnect, connected: false });
  });

  it("connects with hostname + apiKey from the store, not empty args (http)", () => {
    seed({});
    const connect = vi
      .spyOn(useAgentConnectionStore.getState(), "connect")
      .mockResolvedValue(undefined as unknown as void);
    const connectCloud = vi
      .spyOn(useAgentConnectionStore.getState(), "connectCloud")
      .mockImplementation(() => {});
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(
      () => {},
    );
    const select = vi.spyOn(usePairingStore.getState(), "selectPairedDrone");

    connectLocalNode(DEV, { onFocusAgent: () => {} });

    // Selects the canonical `node:<deviceId>` id (shared across transports).
    expect(select).toHaveBeenCalledWith(`node:${DEV}`);
    // The whole point: real LAN creds + deviceId, never connect("","").
    expect(connect).toHaveBeenCalledWith(HOST, KEY, DEV);
    expect(connectCloud).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("connects a workstation node so its compute overview has agent status", () => {
    // A workstation/compute node IS a connectable agent (it serves /api/status,
    // /api/services, /api/resources, /api/logs); the compute overview renders
    // from that agent status + connected flag. It has no FC, so the connection
    // simply reports no flight controller. (The boardless-schema warnings and the
    // touchLastSeen churn that caused the earlier whole-UI jitter are fixed at
    // their source — a tolerant board schema + a debounced presence stamp — and
    // the fleet bridge is reachability-only, so this single status poll is fine.)
    seed({ profile: "workstation" });
    const connect = vi
      .spyOn(useAgentConnectionStore.getState(), "connect")
      .mockResolvedValue(undefined as unknown as void);
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(
      () => {},
    );
    const select = vi.spyOn(usePairingStore.getState(), "selectPairedDrone");
    const onError = vi.fn();

    connectLocalNode(DEV, { onFocusAgent: () => {}, onError });

    expect(select).toHaveBeenCalledWith(`node:${DEV}`);
    expect(connect).toHaveBeenCalledWith(HOST, KEY, DEV);
    expect(onError).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("surfaces a missing-credentials error instead of connecting", () => {
    seed({ hostname: "", apiKey: "" });
    const connect = vi
      .spyOn(useAgentConnectionStore.getState(), "connect")
      .mockResolvedValue(undefined as unknown as void);
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(
      () => {},
    );
    const onError = vi.fn();

    connectLocalNode(DEV, { onFocusAgent: () => {}, onError });

    expect(connect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("missing_lan_credentials");
    expect(useAgentConnectionStore.getState().connectionError).toMatch(
      /Missing LAN credentials/i,
    );

    vi.restoreAllMocks();
  });
});
