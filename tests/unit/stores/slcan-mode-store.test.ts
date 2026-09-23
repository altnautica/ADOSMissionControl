import { describe, it, expect, beforeEach } from "vitest";
import {
  useSlcanModeStore,
  type SlcanModeSnapshot,
} from "@/stores/slcan-mode-store";

function snapshot(): SlcanModeSnapshot {
  const s = useSlcanModeStore.getState();
  return {
    state: s.state,
    droneId: s.droneId,
    bus: s.bus,
    bitrate: s.bitrate,
    timeoutSec: s.timeoutSec,
    errorMessage: s.errorMessage,
    exitFn: s.exitFn,
  };
}

describe("useSlcanModeStore — transitions", () => {
  beforeEach(() => {
    useSlcanModeStore.getState().reset();
  });

  it("starts IDLE with null fields", () => {
    const s = snapshot();
    expect(s.state).toBe("IDLE");
    expect(s.droneId).toBeNull();
    expect(s.bus).toBeNull();
  });

  it("beginEntering transitions IDLE → ENTERING_SLCAN and captures args", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "drone-1",
      bus: 1,
      bitrate: 1_000_000,
      timeoutSec: 120,
    });
    const s = snapshot();
    expect(s.state).toBe("ENTERING_SLCAN");
    expect(s.droneId).toBe("drone-1");
    expect(s.bus).toBe(1);
    expect(s.bitrate).toBe(1_000_000);
    expect(s.timeoutSec).toBe(120);
  });

  it("markActive transitions ENTERING_SLCAN → SLCAN_ACTIVE and keeps the idle timeout", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markActive();
    const s = snapshot();
    expect(s.state).toBe("SLCAN_ACTIVE");
    expect(s.timeoutSec).toBe(60);
  });

  it("beginExiting only transitions from SLCAN_ACTIVE", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().beginExiting();
    // Should not transition from ENTERING_SLCAN.
    expect(snapshot().state).toBe("ENTERING_SLCAN");

    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().beginExiting();
    expect(snapshot().state).toBe("EXITING_SLCAN");
  });

  it("markReconnecting then reset return to IDLE", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 2, bitrate: 500_000, timeoutSec: 30,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().beginExiting();
    useSlcanModeStore.getState().markReconnecting();
    expect(snapshot().state).toBe("RECONNECTING_MAVLINK");
    useSlcanModeStore.getState().reset();
    expect(snapshot().state).toBe("IDLE");
    expect(snapshot().droneId).toBeNull();
  });

  it("markError captures message and moves to ERROR", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markError("BEL on open");
    expect(snapshot().state).toBe("ERROR");
    expect(snapshot().errorMessage).toBe("BEL on open");
  });
});

describe("useSlcanModeStore — single-flight", () => {
  beforeEach(() => {
    useSlcanModeStore.getState().reset();
  });

  it("rejects a second beginEntering while ENTERING_SLCAN", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    expect(() =>
      useSlcanModeStore.getState().beginEntering({
        droneId: "d2", bus: 2, bitrate: 500_000, timeoutSec: 30,
      }),
    ).toThrowError(/Cannot begin SLCAN entry/);
  });

  it("rejects a second beginEntering while SLCAN_ACTIVE", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markActive();
    expect(() =>
      useSlcanModeStore.getState().beginEntering({
        droneId: "d2", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
      }),
    ).toThrow();
  });

  it("allows re-entry from ERROR after a prior failure", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markError("boom");
    expect(() =>
      useSlcanModeStore.getState().beginEntering({
        droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
      }),
    ).not.toThrow();
    expect(snapshot().state).toBe("ENTERING_SLCAN");
  });
});

describe("useSlcanModeStore — exitFn registry", () => {
  beforeEach(() => {
    useSlcanModeStore.getState().reset();
  });

  it("stores the exitFn registered after markActive", () => {
    const fn = async () => {};
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().setExitFn(fn);
    expect(snapshot().exitFn).toBe(fn);
  });

  it("clears exitFn on beginExiting", () => {
    const fn = async () => {};
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().setExitFn(fn);
    useSlcanModeStore.getState().beginExiting();
    expect(snapshot().exitFn).toBeNull();
  });

  it("clears exitFn on reset", () => {
    const fn = async () => {};
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 60,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().setExitFn(fn);
    useSlcanModeStore.getState().reset();
    expect(snapshot().exitFn).toBeNull();
  });
});
