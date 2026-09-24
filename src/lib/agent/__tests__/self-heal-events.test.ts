/**
 * Camera USB-recovery event wording. The agent's recovery has no attempt
 * budget: a camera that has not come back sits in `retrying` and each event
 * carries the episode's `attempt` count, with no ceiling field.
 */

import { describe, expect, it } from "vitest";

import {
  summarizeSelfHealEvent,
  type SelfHealTranslator,
} from "../self-heal-events";

/** Echo the key and its interpolation values so assertions see both. */
const t: SelfHealTranslator = (key, values) =>
  values ? `${key}${JSON.stringify(values)}` : key;

describe("summarizeSelfHealEvent camera.usb_recovery", () => {
  it("words the retry cooldown with the episode's attempt count", () => {
    const { summary, severity } = summarizeSelfHealEvent(
      t,
      "camera.usb_recovery",
      { state: "retrying", attempt: 3, cooldown_s: 60 },
    );
    expect(summary).toBe(
      'events.cameraStepAttempt{"verb":"cameraSteps.retrying","attempt":3}',
    );
    expect(severity).toBe("warning");
  });

  it("shows the attempt on an active step without a ceiling field", () => {
    const { summary } = summarizeSelfHealEvent(t, "camera.usb_recovery", {
      state: "port_cycling",
      attempt: 2,
    });
    expect(summary).toBe(
      'events.cameraStepAttempt{"verb":"cameraSteps.portCycling","attempt":2}',
    );
  });

  it("omits the attempt when the event carries none", () => {
    const { summary } = summarizeSelfHealEvent(t, "camera.usb_recovery", {
      state: "rebinding",
      attempt: 0,
    });
    expect(summary).toBe('events.cameraStep{"verb":"cameraSteps.rebinding"}');
  });

  it("renders an unknown step as the agent's own token", () => {
    const { summary } = summarizeSelfHealEvent(t, "camera.usb_recovery", {
      state: "future_step",
    });
    expect(summary).toBe('events.cameraStep{"verb":"future_step"}');
  });
});
