/**
 * @license GPL-3.0-only
 * Unit tests for the surface-gate resolver: one assertion per GateResult mode.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSurfaceGate } from "@/hooks/use-surface-gate";
import { useDroneManager } from "@/stores/drone-manager";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { isDemoMode } from "@/lib/utils";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, isDemoMode: vi.fn(() => false) };
});

function setFreshness(kind: "live" | "stale" | "offline" | "unknown") {
  const now = Date.now();
  const at =
    kind === "live"
      ? now
      : kind === "stale"
        ? now - 50_000
        : kind === "offline"
          ? now - 70_000
          : null;
  useAgentSystemStore.setState({ lastUpdatedAt: at });
}

beforeEach(() => {
  (isDemoMode as Mock).mockReturnValue(false);
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useAgentConnectionStore.setState({
    connected: false,
    cloudMode: false,
    cloudDeviceId: null,
  });
  // local-nodes-store is persisted; its default is already nodes: [] and these
  // tests never add nodes, so leave it untouched (a write trips the test env).
  usePairingStore.setState({ pairedDrones: [] });
  useCommandFleetStore.getState().clear();
  useAgentCapabilitiesStore.getState().clear();
  setFreshness("unknown");
});

const gate = (req: Parameters<typeof useSurfaceGate>[0], opts?: Parameters<typeof useSurfaceGate>[1]) =>
  renderHook(() => useSurfaceGate(req, opts)).result.current;

describe("useSurfaceGate", () => {
  it("no connection at all → fc requirement is no-fc", () => {
    expect(gate("fc").mode).toBe("no-fc");
  });

  it("fc present for the drone → ok", () => {
    useDroneManager.setState({
      drones: new Map([["d1", { id: "d1" } as never]]),
    });
    expect(gate("fc", { droneId: "d1" }).mode).toBe("ok");
  });

  it("fc absent for the drone → no-fc", () => {
    useDroneManager.setState({ drones: new Map([["other", {} as never]]) });
    expect(gate("fc", { droneId: "d1" }).mode).toBe("no-fc");
  });

  it("agent requirement with no agent → locked", () => {
    expect(gate("agent").mode).toBe("locked");
  });

  it("agent online and live → ok", () => {
    useAgentConnectionStore.setState({ connected: true });
    setFreshness("live");
    expect(gate("agent-online").mode).toBe("ok");
  });

  it("agent online but stale → stale", () => {
    useAgentConnectionStore.setState({ connected: true });
    setFreshness("stale");
    expect(gate("agent-online").mode).toBe("stale");
  });

  it("agent online but offline heartbeat → offline", () => {
    useAgentConnectionStore.setState({ connected: true });
    setFreshness("offline");
    const r = gate("agent-online");
    expect(r.mode).toBe("offline");
    expect(r.lastSeenLabel).toBeDefined();
  });

  it("agent connected, no heartbeat timestamp yet → ok (do not block live link)", () => {
    useAgentConnectionStore.setState({ connected: true });
    setFreshness("unknown");
    expect(gate("agent-online").mode).toBe("ok");
  });

  it("fc-on-agent: agent reports FC connected → ok", () => {
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "dev" });
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "dev", fcConnected: true, updatedAt: Date.now() },
    ]);
    expect(gate("fc-on-agent", { deviceId: "dev" }).mode).toBe("ok");
  });

  it("fc-on-agent: port advertised but not talking → fc-unverified", () => {
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "dev" });
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "dev", fcConnected: false, fcPort: "/dev/ttyAMA0", fcBaud: 921600, updatedAt: Date.now() },
    ]);
    const r = gate("fc-on-agent", { deviceId: "dev" });
    expect(r.mode).toBe("fc-unverified");
    expect(r.fcPort).toBe("/dev/ttyAMA0");
  });

  it("fc-on-agent: no port at all → no-fc", () => {
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "dev" });
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: "dev", fcConnected: false, updatedAt: Date.now() },
    ]);
    expect(gate("fc-on-agent", { deviceId: "dev" }).mode).toBe("no-fc");
  });

  it("fc-on-agent: a reachable MSP FC reads ok, not no-fc", () => {
    // Betaflight/iNav never emit the MAVLink heartbeat fcConnected gates on.
    // Reading the raw field made a present, drivable board render as absent.
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "dev" });
    useCommandFleetStore.getState().upsertCloudStatuses([
      {
        deviceId: "dev",
        fcConnected: false,
        fcVariant: "betaflight",
        transportOpen: true,
        fcPort: "/dev/ttyACM0",
        updatedAt: Date.now(),
      },
    ]);
    expect(gate("fc-on-agent", { deviceId: "dev" }).mode).toBe("ok");
  });

  it("fc-on-agent: the agent's own fcReachable verdict wins", () => {
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "dev" });
    useCommandFleetStore.getState().upsertCloudStatuses([
      {
        deviceId: "dev",
        fcConnected: false,
        fcReachable: true,
        updatedAt: Date.now(),
      },
    ]);
    expect(gate("fc-on-agent", { deviceId: "dev" }).mode).toBe("ok");
  });

  it("fc-on-agent: no status row at all does NOT assert no-fc", () => {
    // Absence of data is not evidence of absent hardware. Falling through to
    // "no flight controller detected" here claimed something never observed.
    useAgentConnectionStore.setState({ connected: true, cloudDeviceId: "nostatus" });
    expect(gate("fc-on-agent", { deviceId: "nostatus" }).mode).toBe("loading");
  });

  it("capability camera missing once loaded → capability-missing", () => {
    useAgentCapabilitiesStore.setState({ loaded: true, cameras: [] });
    const r = gate("capability:camera");
    expect(r.mode).toBe("capability-missing");
    expect(r.capability).toBe("camera");
  });

  it("capability camera present → ok", () => {
    useAgentCapabilitiesStore.setState({
      loaded: true,
      cameras: [{ id: "cam0" } as never],
    });
    expect(gate("capability:camera").mode).toBe("ok");
  });

  it("capability not loaded yet → loading (never claim absent)", () => {
    useAgentCapabilitiesStore.setState({ loaded: false, cameras: [] });
    expect(gate("capability:camera").mode).toBe("loading");
  });

  it("demo mode resolves every surface to ok", () => {
    (isDemoMode as Mock).mockReturnValue(true);
    expect(gate("agent").mode).toBe("ok");
    expect(gate("fc").mode).toBe("ok");
    expect(gate("capability:camera").mode).toBe("ok");
  });
});
