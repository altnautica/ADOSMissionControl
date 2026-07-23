import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useCommandAgentFleet } from "@/hooks/use-command-agent-fleet";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

function drone(over: Partial<FleetNodeEntry>): FleetNodeEntry {
  return {
    _id: over.deviceId ?? "id",
    deviceId: over.deviceId ?? "dev",
    name: over.name ?? "node",
    ...over,
  } as FleetNodeEntry;
}

describe("useCommandAgentFleet profile/role/radio", () => {
  beforeEach(() => {
    useCommandFleetStore.setState({ cloudStatuses: {}, telemetryByDeviceId: {} });
  });

  it("surfaces ground-station profile/role and a normalized radio block", () => {
    useCommandFleetStore.setState({
      cloudStatuses: {
        gs1: {
          deviceId: "gs1",
          updatedAt: Date.now(),
          radio: {
            state: "connected",
            rssiDbm: -40,
            snrDb: 34,
            lossPercent: 0.3,
            bitrateKbps: 4431,
            pairedWithDeviceId: "drone-abc12345",
          },
        },
      },
      telemetryByDeviceId: {},
    });

    const drones = [
      drone({ deviceId: "gs1", name: "gs", profile: "ground-station", role: "direct" }),
    ];
    const { result } = renderHook(() =>
      useCommandAgentFleet(drones, new Set(), new Set()),
    );
    const gs = result.current.find((a) => a.identity.deviceId === "gs1")!;
    expect(gs.profile).toBe("ground-station");
    expect(gs.role).toBe("direct");
    expect(gs.radio?.rssiDbm).toBe(-40);
    expect(gs.radio?.snrDb).toBe(34);
    expect(gs.radio?.lossPercent).toBe(0.3);
    expect(gs.radio?.bitrateKbps).toBe(4431);
    expect(gs.radio?.pairedWithDeviceId).toBe("drone-abc12345");
  });

  it("defaults profile to drone and radio to null when absent", () => {
    const drones = [drone({ deviceId: "d1", name: "drone" })];
    const { result } = renderHook(() =>
      useCommandAgentFleet(drones, new Set(), new Set()),
    );
    const d = result.current.find((a) => a.identity.deviceId === "d1")!;
    expect(d.profile).toBe("drone");
    expect(d.role).toBeNull();
    expect(d.radio).toBeNull();
  });
});
