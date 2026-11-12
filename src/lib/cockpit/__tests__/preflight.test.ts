import { beforeEach, describe, expect, it } from "vitest";

import {
  fcPrearmItem,
  fcPrearmTexts,
  firstArmAllowed,
  preflightItems,
  storageItem,
  type PreflightInputs,
  type PreflightItem,
} from "@/lib/cockpit/preflight";
import type { NavSourceResult } from "@/lib/hud/nav-source";
import { preflightChecks, type PreflightCheck } from "@/lib/hud/preflight";
import { useChecklistStore } from "@/stores/checklist-store";
import { specText } from "@/lib/hud/spec-text";

/** The shared checks for a live, fixed, charged vehicle with a home. */
function shared(over: { live?: boolean; fix?: number; remaining?: number | null; home?: boolean } = {}): PreflightCheck[] {
  const live = over.live ?? true;
  const remaining = over.remaining === undefined ? 80 : over.remaining;
  return preflightChecks({
    telemetry: {
      battery: remaining === null ? null : { remaining, voltage: 16.2 },
      gps: { fix_type: over.fix ?? 3 },
      home: over.home === false ? null : { lat_e7: 129716000, lon_e7: 775946000 },
      ekf: null,
    },
    battery: null,
    live,
  });
}

const GPS_3D: NavSourceResult = { kind: "gps", quality: "good", tone: "good", activeSet: 1, fix: "3d", sats: 12 };

function inputs(over: Partial<PreflightInputs> = {}): PreflightInputs {
  return {
    readiness: [],
    prearm: [],
    checks: shared(),
    live: true,
    nav: GPS_3D,
    controlMode: null,
    controller: { connected: false, name: null },
    onScreenSticks: false,
    storagePct: 40,
    ...over,
  };
}

const state = (items: readonly PreflightItem[], id: string) => items.find((i) => i.id === id)?.state;

describe("pre-flight storage item", () => {
  it("passes below 90 %, warns from 90 %, fails from 97 %", () => {
    expect(storageItem(89).state).toBe("pass");
    expect(storageItem(90).state).toBe("warn");
    expect(storageItem(96.9).state).toBe("warn");
    expect(storageItem(97).state).toBe("fail");
    expect(storageItem(90).label).toBe("On-board storage 90% used");
  });

  it("warns when the node does not report it", () => {
    expect(storageItem(null)).toEqual({ id: "storage", label: "On-board storage (not reported)", state: "warn" });
  });
});

describe("pre-flight FC pre-arm item", () => {
  it("fails on a pre-arm text, showing the newest", () => {
    expect(fcPrearmItem(["PreArm: Compass not calibrated", "PreArm: Throttle below failsafe"])).toEqual({
      id: "fc_prearm",
      label: "Throttle below failsafe",
      state: "fail",
    });
  });

  it("passes with none and is absent while unknown", () => {
    expect(fcPrearmItem([])?.state).toBe("pass");
    expect(fcPrearmItem([])?.label).toBe("Flight controller checks");
    expect(fcPrearmItem(undefined)).toBeNull();
  });

  it("reads the pilot's ring, else the direct-link lines only while the FC bit fails", () => {
    const ring = [
      { severity: 2, text: "PreArm: Gyros inconsistent", ageMs: 0 },
      { severity: 4, text: "EKF3 IMU0 is using GPS", ageMs: 0 },
      { severity: 2, text: "PreArm: Compass not calibrated", ageMs: 0 },
    ];
    expect(fcPrearmTexts({ pilotStatustext: ring, sysStatusPrearmOk: null, directLines: [] })).toEqual([
      "PreArm: Compass not calibrated",
      "PreArm: Gyros inconsistent",
    ]);
    expect(fcPrearmTexts({ pilotStatustext: [], sysStatusPrearmOk: null, directLines: [] })).toEqual([]);
    expect(fcPrearmTexts({ pilotStatustext: null, sysStatusPrearmOk: null, directLines: ["PreArm: x"] })).toBeUndefined();
    expect(fcPrearmTexts({ pilotStatustext: null, sysStatusPrearmOk: true, directLines: ["PreArm: x"] })).toEqual([]);
    expect(fcPrearmTexts({ pilotStatustext: null, sysStatusPrearmOk: false, directLines: ["PreArm: x"] })).toEqual(["PreArm: x"]);
    expect(fcPrearmItem(fcPrearmTexts({ pilotStatustext: null, sysStatusPrearmOk: false, directLines: [] }))).toEqual({
      id: "fc_prearm",
      label: "Flight controller checks",
      state: "fail",
    });
  });
});

describe("pre-flight checklist", () => {
  it("lists the spec items in order with spec texts", () => {
    const items = preflightItems(
      inputs({
        readiness: [{ id: "profile", ok: true, severity: "block", msg: "Flight profile loaded" }],
        controlMode: "ados",
        controller: { connected: true, name: "Wireless Controller" },
      }),
    );
    expect(items.map((i) => [i.id, i.label, i.state])).toEqual([
      ["link", "Vehicle link fresh", "pass"],
      ["gps", "GPS fix 3D or better", "pass"],
      ["battery", "Battery above the low band", "pass"],
      ["home", "Home position set", "pass"],
      ["pilot:profile", "Flight profile loaded", "pass"],
      ["fc_prearm", "Flight controller checks", "pass"],
      ["nav_source", "Navigation source", "pass"],
      ["controller", "Controller connected (Wireless Controller)", "pass"],
      ["storage", "On-board storage 40% used", "pass"],
    ]);
    expect(firstArmAllowed(items)).toBe(true);
  });

  it("blocks the first arm on a failing FC pre-arm check", () => {
    const items = preflightItems(inputs({ prearm: ["PreArm: Compass not calibrated"] }));
    expect(state(items, "fc_prearm")).toBe("fail");
    expect(firstArmAllowed(items)).toBe(false);
  });

  it("fails a blocking pilot item and warns a warning one", () => {
    const items = preflightItems(
      inputs({
        readiness: [
          { id: "pos", ok: false, severity: "block", msg: "No position estimate" },
          { id: "rf", ok: false, severity: "warn", msg: "" },
        ],
      }),
    );
    expect(items.filter((i) => i.id.startsWith("pilot:"))).toEqual([
      { id: "pilot:pos", label: "No position estimate", state: "fail" },
      { id: "pilot:rf", label: "rf", state: "warn" },
    ]);
    expect(firstArmAllowed(items)).toBe(false);
  });

  it("fails the link and an unknown or low battery; warns the nav source", () => {
    const down = preflightItems(inputs({ live: false, checks: shared({ live: false }) }));
    expect(state(down, "link")).toBe("fail");
    expect(state(down, "nav_source")).toBe("warn");
    expect(state(preflightItems(inputs({ checks: shared({ remaining: null }) })), "battery")).toBe("fail");
    expect(state(preflightItems(inputs({ checks: shared({ remaining: 20 }) })), "battery")).toBe("fail");
    expect(state(preflightItems(inputs({ checks: shared({ home: false }) })), "home")).toBe("fail");
    const noFix = preflightItems(inputs({ nav: { ...GPS_3D, quality: "noFix", tone: "crit", fix: "2d" } }));
    expect(state(noFix, "nav_source")).toBe("warn");
    expect(firstArmAllowed(noFix)).toBe(true);
  });

  it("words a failing own item as the fault, without a source prefix", () => {
    const noFix = preflightItems(inputs({ nav: { ...GPS_3D, quality: "noFix", tone: "crit", fix: "2d" } }));
    expect(noFix.find((i) => i.id === "nav_source")?.label).toBe(
      specText("alert.nav_source_degraded", { source: specText("nav_source.gps") }),
    );
    const down = preflightItems(inputs({ live: false }));
    expect(down.find((i) => i.id === "nav_source")?.label).toBe("Navigation source (not reported)");
    const pad = preflightItems(inputs({ controlMode: "ados" }));
    expect(pad.find((i) => i.id === "controller")?.label).toBe(specText("controls.no_controller"));
    const fc = preflightItems(inputs({ prearm: ["PreArm: Compass not calibrated"] }));
    expect(fc.find((i) => i.id === "fc_prearm")?.label).toBe("Compass not calibrated");
  });

  it("shows the controller only when the pilot flies the sticks, warning when absent", () => {
    expect(state(preflightItems(inputs()), "controller")).toBeUndefined();
    const items = preflightItems(inputs({ controlMode: "ados" }));
    expect(items.find((i) => i.id === "controller")?.state).toBe("warn");
    const sticks = preflightItems(inputs({ controlMode: "ados", onScreenSticks: true }));
    expect(sticks.find((i) => i.id === "controller")).toEqual({
      id: "controller",
      label: "Controller connected (or on-screen sticks / skills only)",
      state: "pass",
    });
  });

  it("accepts warnings at the gate and refuses at a 97 % full disk", () => {
    expect(firstArmAllowed(preflightItems(inputs({ storagePct: 92 })))).toBe(true);
    expect(firstArmAllowed(preflightItems(inputs({ storagePct: 97 })))).toBe(false);
  });
});

describe("the first-arm gate in the checklist store", () => {
  beforeEach(() => useChecklistStore.getState().resetSession());

  it("is ready only once the operator passed a checklist with no failing item", () => {
    const s = useChecklistStore.getState();
    s.startSession("d1");
    expect(s.passPreflight("d1")).toBe(false); // not evaluated yet
    s.setPreflightItems("d1", preflightItems(inputs({ prearm: ["PreArm: Compass not calibrated"] })));
    expect(useChecklistStore.getState().passPreflight("d1")).toBe(false);
    expect(useChecklistStore.getState().isReadyToArm("d1")).toBe(false);

    s.setPreflightItems("d1", preflightItems(inputs({ storagePct: 92 })));
    expect(useChecklistStore.getState().passPreflight("d1")).toBe(true);
    expect(useChecklistStore.getState().isReadyToArm("d1")).toBe(true);
    expect(useChecklistStore.getState().isReadyToArm("d2")).toBe(false);
  });

  it("does not take the manual items into the gate", () => {
    const s = useChecklistStore.getState();
    s.startSession("d1");
    useChecklistStore.setState((st) => ({ items: st.items.map((i) => ({ ...i, status: "skipped" as const })) }));
    expect(useChecklistStore.getState().isReadyToArm("d1")).toBe(false);
  });

  it("ignores another drone's items", () => {
    const s = useChecklistStore.getState();
    s.startSession("d1");
    s.setPreflightItems("d2", preflightItems(inputs()));
    expect(useChecklistStore.getState().preflight).toBeNull();
  });
});
