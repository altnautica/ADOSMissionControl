/**
 * @license GPL-3.0-only
 *
 * Compute capability comes from what the agent declares about its own board
 * (`npuTops`, `hasAccelerator`, `perceptionTier`), on the LAN consolidated
 * status and on the cloud heartbeat alike. A SoC-name lookup on the GCS side
 * missed real boards (a Jetson reporting `soc: "Tegra Orin"`, an A733 board
 * with a 3 TOPS NPU) and an empty `capabilities: {}` block hid the declared
 * values entirely, so every LAN node read "no NPU / 0 TOPS".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { applyFullStatus } from "@/stores/agent-connection/apply-full-status";
import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
} from "@/stores/agent-capabilities-store";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import { buildHeartbeatExtras } from "@/components/command/bridges/status-mapper";
import type { AgentStatus, FullStatusResponse } from "@/lib/agent/types";

const HOST = "http://192.168.1.50:8080";

/** `/api/status/full` as the agent sends it: no `capabilities` key, compute
 * declared at the top level. */
function fullStatus(over: Record<string, unknown>): FullStatusResponse {
  return {
    version: "0.102.0",
    uptime_seconds: 120,
    board: {
      name: "Jetson Orin Nano",
      model: "jetson-orin-nano",
      vendor: "",
      soc: "Tegra Orin",
      arch: "aarch64",
      hw_video_codecs: [],
    },
    health: { temperature: null, timestamp: "" },
    fc_connected: false,
    fc_port: "",
    fc_baud: 0,
    profile: "drone",
    ...over,
  } as unknown as FullStatusResponse;
}

function boardStatus(soc: string): AgentStatus {
  return {
    version: "0.102.0",
    board: {
      name: "Board",
      model: "",
      vendor: "",
      soc,
      arch: "aarch64",
      hw_video_codecs: [],
    },
    health: { temperature: null, timestamp: "" },
    fc_connected: false,
    fc_port: "",
    fc_baud: 0,
  };
}

beforeEach(() => {
  useAgentCapabilitiesStore.setState({ byDevice: {}, focusedDeviceId: null });
  useAgentCapabilitiesStore.getState().clear();
});

describe("LAN status: declared compute", () => {
  it("stores the agent's declared NPU and perception tier", () => {
    applyFullStatus(
      fullStatus({
        npuTops: 40,
        hasAccelerator: true,
        perceptionTier: "local",
        perceptionOffloadTarget: null,
      }),
      HOST,
      "dev-jetson",
    );
    const caps = selectDeviceCapabilities(
      useAgentCapabilitiesStore.getState(),
      "dev-jetson",
    );
    expect(caps?.compute.npu_tops).toBe(40);
    expect(caps?.compute.npu_available).toBe(true);
    expect(caps?.compute.npu_runtime).toBe("tensorrt");
    expect(caps?.npuTops).toBe(40);
    expect(caps?.hasAccelerator).toBe(true);
    expect(caps?.perceptionTier).toBe("local");
    expect(caps?.perceptionOffloadTarget).toBeNull();
    expect(caps?.visionAvailable).toBe(true);
  });

  it("reports no NPU when the agent declares none, whatever the SoC name", () => {
    applyFullStatus(
      fullStatus({
        board: {
          name: "Rock",
          model: "",
          vendor: "",
          soc: "RK3588S2",
          arch: "aarch64",
          hw_video_codecs: [],
        },
        npuTops: 0,
        hasAccelerator: false,
        perceptionTier: "none",
      }),
      HOST,
      "dev-rock",
    );
    const caps = selectDeviceCapabilities(
      useAgentCapabilitiesStore.getState(),
      "dev-rock",
    );
    expect(caps?.compute.npu_tops).toBe(0);
    expect(caps?.compute.npu_available).toBe(false);
    expect(caps?.compute.npu_runtime).toBeNull();
    expect(caps?.perceptionTier).toBe("none");
  });
});

describe("cloud heartbeat: declared compute", () => {
  it("takes NPU throughput from the heartbeat, not from a SoC name", () => {
    // An NPU board whose SoC string no lookup table would recognise.
    const extras = buildHeartbeatExtras({ npuTops: 3, hasAccelerator: true });
    const caps = inferCapabilities(
      boardStatus("Allwinner A733"),
      [],
      extras.inferOverrides,
    );
    expect(caps?.compute.npu_tops).toBe(3);
    expect(caps?.compute.npu_available).toBe(true);
    expect(caps?.hasAccelerator).toBe(true);
  });

  it("does not invent an NPU for a SoC the agent declares without one", () => {
    const extras = buildHeartbeatExtras({ npuTops: 0, hasAccelerator: false });
    const caps = inferCapabilities(
      boardStatus("RK3588"),
      [],
      extras.inferOverrides,
    );
    expect(caps?.compute.npu_tops).toBe(0);
    expect(caps?.compute.npu_available).toBe(false);
    expect(caps?.hasAccelerator).toBe(false);
  });
});
