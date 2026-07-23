import { describe, it, expect, beforeEach } from "vitest";
import { useAgentCapabilitiesStore } from "../state";

// The capabilities store is a singleton that reflects the currently-focused
// node. Each setCapabilities call fully determines the crsf field, so
// isolation between nodes is a refocus test: one node's lane must never bleed
// into the next.

// A ground-station transmitter with a healthy lane (camelCase, heartbeat form).
const gsLaneOk = {
  state: "link_ok",
  rssiDbm: -70,
  lqUplink: 96,
  rfUnverified: false,
};

// A relay drone whose lane is transmitting but unproven (snake_case, LAN form),
// with the real TX power the heartbeat projection would not carry.
const droneLaneUnverified = {
  state: "rf_unverified",
  rssi_dbm: -95,
  rf_unverified: null,
  tx_power_mw: 250,
  relay_role: "relay",
};

describe("per-node crsf store", () => {
  beforeEach(() => {
    useAgentCapabilitiesStore.getState().clear();
  });

  it("starts null before any capabilities land", () => {
    expect(useAgentCapabilitiesStore.getState().crsf).toBeNull();
  });

  it("populates the field from a node's crsf block", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({ crsf: gsLaneOk });
    const crsf = useAgentCapabilitiesStore.getState().crsf;
    expect(crsf).not.toBeNull();
    expect(crsf!.state).toBe("link_ok");
    expect(crsf!.rssiDbm).toBe(-70);
    expect(crsf!.rfUnverified).toBe(false);
  });

  it("does not bleed one node's lane into a node that has none", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({ crsf: gsLaneOk });
    expect(useAgentCapabilitiesStore.getState().crsf).not.toBeNull();
    // Refocus onto a node whose heartbeat carries no crsf block at all.
    useAgentCapabilitiesStore.getState().setCapabilities({});
    expect(useAgentCapabilitiesStore.getState().crsf).toBeNull();
  });

  it("replaces one node's lane with another node's on refocus", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({ crsf: gsLaneOk });
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ crsf: droneLaneUnverified });
    const crsf = useAgentCapabilitiesStore.getState().crsf;
    expect(crsf!.state).toBe("rf_unverified");
    expect(crsf!.rssiDbm).toBe(-95);
    expect(crsf!.txPowerMw).toBe(250); // read from the snake_case LAN sidecar
    expect(crsf!.relayRole).toBe("relay");
    expect(crsf!.rfUnverified).toBeNull(); // explicit null → no verdict
  });

  it("carries the rf_unverified state through the store as itself", () => {
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ crsf: { state: "rf_unverified" } });
    expect(useAgentCapabilitiesStore.getState().crsf!.state).toBe(
      "rf_unverified",
    );
  });

  it("clears the lane back to null on clear()", () => {
    useAgentCapabilitiesStore.getState().setCapabilities({ crsf: gsLaneOk });
    useAgentCapabilitiesStore.getState().clear();
    expect(useAgentCapabilitiesStore.getState().crsf).toBeNull();
  });
});
