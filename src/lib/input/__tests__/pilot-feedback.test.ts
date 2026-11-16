/**
 * @license GPL-3.0-only
 *
 * Controller rumble from pilot-state changes, run from the shared rule table
 * (`ds4.json` `feedback`): the first state earns nothing; a profile, owner
 * or takeover change plays the mode-change pattern; avoiding, a new hold
 * reason or a speed cap coming on warns; a lost controller, the link-loss
 * countdown, a failsafe or the surface losing the pilot state is critical;
 * only the strongest class of one update plays, once.
 */

import { describe, expect, it } from "vitest";

import ds4 from "@/lib/cockpit-spec/ds4.json";
import { feedbackAlert as feedbackFor } from "@/lib/hud/pilot-feedback";
import { PilotFeedback } from "../pilot-feedback";

const BASE = {
  owner: "pilot",
  profile: "normal",
  control_mode: "ados",
  armed: true,
  avoid_state: "clear",
  hold_reason: null,
  input_session: { src: "mc", label: "Mission Control", session: 11 },
  readiness: [],
};

const next = (patch: Record<string, unknown>) => ({ ...BASE, ...patch });

describe("pilot feedback rules", () => {
  const cases: [string, Record<string, unknown>, string | null][] = [
    ["nothing changed", {}, null],
    ["profile change", { profile: "sport" }, "mode_change"],
    ["owner change", { owner: "skill" }, "mode_change"],
    ["takeover by another session", { input_session: { src: "gs", label: "Pad", session: 12 } }, "mode_change"],
    ["control mode change", { control_mode: "fc_manual" }, "mode_change"],
    ["avoiding", { avoid_state: "detour" }, "warning"],
    ["blocked", { avoid_state: "blocked" }, "warning"],
    ["a new hold reason", { hold_reason: "geofence" }, "warning"],
    ["a speed cap comes on", { speed_cap: { reason: "gnss-denied", v_max_mps: 2 } }, "warning"],
    ["a new readiness warning", { readiness: [{ id: "gps", ok: false, severity: "warn", msg: "" }] }, "warning"],
    ["controller lost", { hold_reason: "controller-lost" }, "critical"],
    ["link-loss countdown", { link_loss_in_s: 5 }, "critical"],
    ["failsafe", { fc_failsafe: true }, "critical"],
    ["low-battery countdown", { rth_countdown_s: 10 }, "critical"],
    ["a new blocking readiness item while armed", { readiness: [{ id: "ekf", ok: false, severity: "block", msg: "" }] }, "critical"],
    ["critical outranks a mode change in the same update", { profile: "cine", link_loss_in_s: 3 }, "critical"],
    ["warning outranks a mode change in the same update", { owner: "goto", avoid_state: "blocked" }, "warning"],
  ];
  it.each(cases)("%s", (_name, patch, want) => {
    expect(feedbackFor(BASE, next(patch))).toBe(want);
  });

  it("a blocking readiness item does not rumble while disarmed", () => {
    const prev = next({ armed: false });
    expect(feedbackFor(prev, next({ armed: false, readiness: [{ id: "ekf", ok: false, severity: "block", msg: "" }] }))).toBeNull();
  });

  it("a readiness item already failing does not rumble again", () => {
    const r = [{ id: "gps", ok: false, severity: "warn", msg: "" }];
    expect(feedbackFor(next({ readiness: r }), next({ readiness: r }))).toBeNull();
  });

  it("a hold reason clearing or staying does not rumble", () => {
    expect(feedbackFor(next({ hold_reason: "geofence" }), next({ hold_reason: null }))).toBeNull();
    expect(feedbackFor(next({ hold_reason: "geofence" }), next({ hold_reason: "geofence" }))).toBeNull();
  });

  it("a takeover is another source or session replacing one; sticks resuming, stopping or relabelled are not", () => {
    const session = (s: unknown) => next({ input_session: s });
    expect(feedbackFor(session({ src: "mc", label: "A", session: 11 }), session({ src: "mc", label: "A", session: 12 }))).toBe("mode_change");
    expect(feedbackFor(session(null), session({ src: "mc", label: "A", session: 11 }))).toBeNull();
    expect(feedbackFor(session({ src: "mc", label: "A", session: 11 }), session(null))).toBeNull();
    expect(feedbackFor(session({ src: "mc", label: "A", session: 11 }), session({ src: "mc", label: "B", session: 11 }))).toBeNull();
  });

  it("each class names a rumble pattern of the spec", () => {
    expect(ds4.feedback.order).toEqual(["critical", "warning", "mode_change"]);
    for (const cls of ds4.feedback.order) expect(Object.keys(ds4.rumble)).toContain(cls);
  });
});

describe("PilotFeedback", () => {
  it("the first state earns nothing", () => {
    const f = new PilotFeedback();
    expect(f.update(next({ hold_reason: "controller-lost" }))).toBeNull();
    expect(f.update(next({ profile: "sport", hold_reason: "controller-lost" }))).toBe("mode_change");
  });

  it("losing the pilot state is critical once, and the first state after it earns nothing", () => {
    const f = new PilotFeedback();
    expect(f.lost()).toBeNull();
    f.update(BASE);
    expect(f.lost()).toBe("critical");
    expect(f.lost()).toBeNull();
    expect(f.update(next({ profile: "sport" }))).toBeNull();
    expect(f.update(next({ profile: "cine" }))).toBe("mode_change");
  });
});
