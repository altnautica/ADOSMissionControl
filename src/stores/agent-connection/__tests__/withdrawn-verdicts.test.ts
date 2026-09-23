/**
 * @license GPL-3.0-only
 *
 * The agent's consolidated status omits a supervisor verdict (management-link
 * guardian, stable-MAC pins, camera USB recovery, ...) once its sidecar goes
 * stale, so a stopped supervisor does not render its last verdict as live.
 * The LAN poll therefore treats an omitted verdict as withdrawn: the store
 * clears it instead of keeping the previous value on screen as current. A
 * sparse capability payload from any other writer still keeps the prior value.
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
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { FullStatusResponse } from "@/lib/agent/types";

// `/api/status/full` body (ados-control routes/status_full.rs) with every
// reconciler sidecar fresh.
const BASE = {
  version: "0.99.300",
  uptime_seconds: 120,
  board: { soc: "unknown" },
  health: { status: "ok" },
  fc_connected: false,
  fc_port: "",
  fc_baud: 0,
  profile: "drone",
  capabilities: {},
};

const WITH_VERDICTS = {
  ...BASE,
  managementLink: { state: "healthy", iface: "wlan0" },
  macStability: { adapters: [{ iface: "wlan1", pinned: true }] },
  cameraUsbRecovery: { state: "monitoring", attempts: 0, maxAttempts: 3 },
  usbRehomeState: "idle",
  mgmtLinkMode: "primary",
};

const full = (body: object) => body as unknown as FullStatusResponse;

describe("LAN status withdraws stale supervisor verdicts", () => {
  beforeEach(() => {
    useAgentCapabilitiesStore.setState({
      managementLink: undefined,
      macStability: undefined,
      cameraUsbRecovery: undefined,
      usbRehomeState: undefined,
      mgmtLinkMode: undefined,
      byDevice: {},
    });
  });

  it("clears verdicts the agent stopped reporting", () => {
    applyFullStatus(full(WITH_VERDICTS), "http://192.168.1.50:8080", "dev-a");
    const before = useAgentCapabilitiesStore.getState();
    expect(before.managementLink?.state).toBe("healthy");
    expect(before.macStability).toBeDefined();
    expect(before.cameraUsbRecovery?.state).toBe("monitoring");
    expect(before.usbRehomeState).toBe("idle");

    // The guardian stopped: its sidecar went stale, so the agent omits it.
    applyFullStatus(full(BASE), "http://192.168.1.50:8080", "dev-a");
    const after = useAgentCapabilitiesStore.getState();
    expect(after.managementLink).toBeUndefined();
    expect(after.macStability).toBeUndefined();
    expect(after.cameraUsbRecovery).toBeUndefined();
    expect(after.usbRehomeState).toBeUndefined();
    expect(after.mgmtLinkMode).toBeUndefined();
    expect(after.byDevice["dev-a"]?.managementLink).toBeUndefined();
  });

  it("keeps a verdict across a sparse payload that does not claim to be complete", () => {
    applyFullStatus(full(WITH_VERDICTS), "http://192.168.1.50:8080", "dev-a");
    useAgentCapabilitiesStore.getState().setCapabilities({ tier: 2 }, "dev-a");
    expect(useAgentCapabilitiesStore.getState().managementLink?.state).toBe(
      "healthy",
    );
  });
});
