import { describe, it, expect } from "vitest";
import {
  normalizeServiceStatus,
  countRunning,
  isServiceUp,
} from "@/lib/agent/service-state";

/**
 * These fixtures are the shape the agent ACTUALLY emits, taken from
 * `crates/ados-control/src/routes/services.rs`, which writes:
 *
 *   "active":    active_state == "active",
 *   "state":     active_state,      // systemd ActiveState
 *   "sub_state": sub_state,         // systemd SubState
 *
 * They are deliberately not the pre-normalised `{ state: "running" }` shape.
 * A previous test suite elsewhere asserted against that invented shape, so it
 * passed while production stayed broken; anchoring on the real payload is the
 * whole point of this file.
 */
const realAgentPayload = [
  { name: "ados-api", active: true, state: "active", sub_state: "running" },
  { name: "ados-control", active: true, state: "active", sub_state: "running" },
  { name: "ados-mavlink", active: true, state: "active", sub_state: "running" },
  // A oneshot that ran to completion. systemd reports active/exited.
  { name: "ados-power", active: true, state: "active", sub_state: "exited" },
  { name: "ados-vision", active: false, state: "inactive", sub_state: "dead" },
  { name: "ados-broken", active: false, state: "failed", sub_state: "failed" },
];

describe("normalizeServiceStatus", () => {
  it("maps a live systemd unit to running", () => {
    expect(
      normalizeServiceStatus({ active: true, state: "active", sub_state: "running" }),
    ).toBe("running");
  });

  it("treats a completed oneshot (active/exited) as running, not stopped", () => {
    expect(
      normalizeServiceStatus({ active: true, state: "active", sub_state: "exited" }),
    ).toBe("running");
  });

  it("maps failed to error", () => {
    expect(normalizeServiceStatus({ active: false, state: "failed" })).toBe("error");
  });

  it("maps activating and reloading to starting", () => {
    expect(normalizeServiceStatus({ state: "activating" })).toBe("starting");
    expect(normalizeServiceStatus({ state: "reloading" })).toBe("starting");
  });

  it("maps inactive and deactivating to stopped", () => {
    expect(normalizeServiceStatus({ state: "inactive" })).toBe("stopped");
    expect(normalizeServiceStatus({ state: "deactivating" })).toBe("stopped");
  });

  it("reports an unrecognised state as degraded, never as stopped", () => {
    // Claiming a service is down because we did not recognise its state would
    // be a fabricated negative. Unknown must read as unknown.
    expect(normalizeServiceStatus({ state: "some-future-state" })).toBe("degraded");
    expect(normalizeServiceStatus({})).toBe("degraded");
  });

  it("passes an already-normalised UI status straight through", () => {
    expect(normalizeServiceStatus({ status: "circuit_open" })).toBe("circuit_open");
    expect(normalizeServiceStatus({ status: "degraded" })).toBe("degraded");
  });

  it("falls back to the agent's active boolean when no state is present", () => {
    expect(normalizeServiceStatus({ active: true })).toBe("running");
    expect(normalizeServiceStatus({ active: false })).toBe("stopped");
  });

  it("accepts camelCase subState from the cloud payload", () => {
    expect(normalizeServiceStatus({ subState: "running" })).toBe("running");
  });
});

describe("countRunning", () => {
  it("counts a healthy agent's units instead of reporting zero", () => {
    // The regression this guards: every consumer compared the agent's raw
    // "active" against "running" and matched nothing, so a fully healthy box
    // rendered "0/N running" above rows that each read "active".
    const normalised = realAgentPayload.map((s) => ({
      status: normalizeServiceStatus(s),
    }));
    expect(countRunning(normalised)).toBe(4);
    expect(normalised).toHaveLength(6);
  });

  it("returns zero for an empty list", () => {
    expect(countRunning([])).toBe(0);
  });

  it("does not count a raw un-normalised systemd string", () => {
    // Guards the inverse mistake: passing the agent string through unmapped.
    expect(countRunning([{ status: "active" }])).toBe(0);
    expect(isServiceUp("active")).toBe(false);
  });
});
