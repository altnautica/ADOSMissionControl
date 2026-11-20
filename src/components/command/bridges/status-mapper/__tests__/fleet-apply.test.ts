/**
 * @license GPL-3.0-only
 *
 * A fleet slot delivered to a drone waits for it to land before the radio
 * restarts onto it. The agent reports that restart as `radioFleetApply` on the
 * LAN `/api/status/full` and as `radio.fleetApply` in the cloud heartbeat; both
 * paths land on `AgentStatus.radio_fleet_apply`, which the agent card words
 * with the shared fleet slot rule.
 */

import { describe, it, expect, vi } from "vitest";

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

import { mapCloudStatus } from "../agent-status";
import { fullStatusToAgentStatus } from "@/stores/agent-connection/apply-full-status";
import { fleetSlotAlert } from "@/lib/hud/status-pill";
import type { LanStatusFull } from "@/lib/agent/types";

const waiting = { outcome: "deferred_armed", fleetId: 7, fleetSlot: 3, sinceMs: 10, atMs: 20 };

describe("fleet slot restart reaches AgentStatus", () => {
  it("maps the cloud heartbeat's radio.fleetApply, and clears it when the heartbeat drops it", () => {
    const status = mapCloudStatus({ updatedAt: 1_000, radio: { state: "paired", fleetApply: waiting } });
    expect(status.radio_fleet_apply).toEqual({ outcome: "deferred_armed", fleetId: 7, fleetSlot: 3 });
    expect(fleetSlotAlert(status.radio_fleet_apply)?.title).toBe("New fleet slot 3 applies after landing.");
    expect(mapCloudStatus({ updatedAt: 1_000, radio: { state: "paired" } }).radio_fleet_apply).toBeNull();
  });

  it("maps the LAN full status's radioFleetApply", () => {
    const full = { radioFleetApply: { ...waiting, outcome: "restart_failed", unit: "ados-wfb-drone" } } as unknown as LanStatusFull;
    const status = fullStatusToAgentStatus(full);
    expect(status.radio_fleet_apply).toEqual({ outcome: "restart_failed", fleetId: 7, fleetSlot: 3 });
    expect(fleetSlotAlert(status.radio_fleet_apply)?.id).toBe("fleet_slot_failed");
    expect(fullStatusToAgentStatus({} as LanStatusFull).radio_fleet_apply).toBeNull();
  });
});
