/**
 * Focusing the demo compute workstation seeds its capability document, so the
 * compute card has a GPU host to describe instead of waiting forever.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { seedFocusedCapabilities } from "@/mock/demo-seed/agent-focus";
import { DEMO_WORKSTATION } from "@/mock/drones";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useDroneManager } from "@/stores/drone-manager";

describe("demo workstation capabilities", () => {
  it("seeds a GPU compute document for the focused workstation", () => {
    const devId = DEMO_WORKSTATION.deviceId;
    useDroneManager.setState({ selectedDroneId: nodeIdForDevice(devId) });
    seedFocusedCapabilities();
    const caps = useAgentCapabilitiesStore.getState().byDevice[devId];
    expect(caps).toBeDefined();
    expect(caps.compute.gpu_available).toBe(true);
    expect(caps.cameras).toEqual([]);
  });
});
