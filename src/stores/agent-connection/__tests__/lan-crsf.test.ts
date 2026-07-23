/**
 * @license GPL-3.0-only
 *
 * The LAN-direct poll folds the CRSF / ExpressLRS control-lane snapshot the
 * agent now carries on `/api/status/full` into the capability store. Two
 * properties matter:
 *   1. It is profile-agnostic — a DRONE running the ELRS relay lane surfaces the
 *      lane (and therefore the RC / ELRS tab) over the local-first LAN path, not
 *      just a ground station (the old code fetched crsf only for a GS profile).
 *   2. crsf reaches the store atomically through the single setCapabilities
 *      write, never via a separate follow-up setState — so there is no
 *      null-then-real window that flickers the tab.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Persisted local-nodes-store reads localStorage at import time.
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

// A drone (not a ground station) whose consolidated status carries the ELRS
// relay lane. The crsf block is the raw snake_case sidecar body the agent folds
// in verbatim, including the richer LAN-only fields (flyable / pic) and the
// safety gate the cloud projection keeps.
const FULL_WITH_CRSF = {
  version: "0.99.224",
  uptime_seconds: 42,
  board: { soc: "unknown" },
  health: { status: "ok" },
  fc_connected: false,
  fc_port: "",
  fc_baud: 0,
  profile: "drone",
  // An empty capabilities object takes the primary `if (full.capabilities)`
  // branch deterministically; the lane still folds in alongside it.
  capabilities: {},
  radio: { state: "connected" },
  crsf: {
    v: 1,
    state: "rf_unverified",
    rssi_dbm: -90,
    tx_power_mw: 250,
    rf_unverified: null,
    flyable: false,
    pic: "unavailable",
    fc_command_down_gated: true,
    mode: "mavlink",
    relay_role: "origin",
  },
};

// A minimal AgentClient: getStatus resolves so connect() proceeds to polling;
// getFullStatus resolves the drone-with-crsf snapshot. The other system fetches
// (services/resources/logs) fail-soft in their own try/catch when the method is
// absent, so they need no stub.
vi.mock("@/lib/agent/client", () => ({
  AgentClient: class {
    getStatus() {
      return Promise.resolve({
        version: "0.99.224",
        uptime_seconds: 42,
        board: { soc: "unknown" },
        health: { status: "ok" },
        fc_connected: false,
        fc_port: "",
        fc_baud: 0,
      });
    }
    getFullStatus() {
      return Promise.resolve(FULL_WITH_CRSF);
    }
  },
  normaliseSystemResources: (x: unknown) => x,
}));

import { useAgentConnectionStore } from "../index";
import { useAgentCapabilitiesStore } from "../../agent-capabilities-store";
import { useLocalNodesStore } from "../../local-nodes-store";

const HOST = "http://192.168.0.9:8080";

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  useAgentCapabilitiesStore.getState().clear();
  useAgentConnectionStore.getState().disconnect();
  // The no-IPv4 fallback path can poke /api/lan-pair/discover; deny any stray
  // fetch so nothing hangs.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no net")));
});

afterEach(() => {
  useAgentConnectionStore.getState().disconnect();
  vi.unstubAllGlobals();
});

describe("LAN-direct CRSF lane folding", () => {
  it("populates the lane for a DRONE node over LAN (so the RC / ELRS tab shows)", async () => {
    await useAgentConnectionStore.getState().connect(HOST, "key");

    await vi.waitFor(() => {
      expect(useAgentCapabilitiesStore.getState().crsf).not.toBeNull();
    });

    const crsf = useAgentCapabilitiesStore.getState().crsf!;
    // The lane surfaces even though the node is a drone — the tab is gated on
    // `crsf !== null`, so a non-null lane makes crsfPresent true on any profile.
    expect(crsf.state).toBe("rf_unverified");
    // The richer LAN field set folds through verbatim: the cloud projection
    // would drop pic/flyable, but the LAN sidecar carries them.
    expect(crsf.txPowerMw).toBe(250);
    expect(crsf.fcCommandDownGated).toBe(true);
    expect(crsf.flyable).toBe(false);
    expect(crsf.pic).toBe("unavailable");
    expect(crsf.relayRole).toBe("origin");
  });

  it("sets the lane atomically via setCapabilities, never a separate crsf setState (no null-flicker)", async () => {
    const setStateSpy = vi.spyOn(useAgentCapabilitiesStore, "setState");

    await useAgentConnectionStore.getState().connect(HOST, "key");

    await vi.waitFor(() => {
      expect(useAgentCapabilitiesStore.getState().crsf).not.toBeNull();
    });

    // The direct capability-store setState calls the poll makes (radio, runtime
    // mode) must never carry a `crsf` key: crsf reaches the store only through
    // setCapabilities' single write, so it is never set to null and then patched
    // to the real value in a follow-up setState.
    const objectArgs = setStateSpy.mock.calls
      .map((call) => call[0] as unknown)
      .filter(
        (arg): arg is Record<string, unknown> =>
          typeof arg === "object" && arg !== null,
      );
    expect(objectArgs.some((arg) => "crsf" in arg)).toBe(false);
    // Sanity: the poll DID drive direct setState writes (the radio snapshot),
    // so the "no crsf key" assertion is meaningful and not vacuous.
    expect(objectArgs.some((arg) => "radio" in arg)).toBe(true);
  });
});
