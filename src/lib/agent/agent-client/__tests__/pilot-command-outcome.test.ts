/**
 * In `ados` control the agent hands a flight primitive (`rtl`, `land`, ...) to
 * its pilot and answers with the pilot's verdict instead of a flight
 * controller ack block. That verdict is the command's answer: an accepted one
 * reads as accepted, a refusal carries the pilot's reason.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { decodeAgentCommandOutcome } from "@/lib/agent/agent-client/system/commands";

describe("pilot command outcome", () => {
  it("reads the pilot's acceptance as accepted", () => {
    const outcome = decodeAgentCommandOutcome({ status: "ok", cmd: "rtl", via: "pilot", action: "rth" });
    expect(outcome).toMatchObject({ acknowledged: true, accepted: true, resultCode: null });
  });

  it("reads the pilot's refusal as answered and refused, with its reason", () => {
    const outcome = decodeAgentCommandOutcome({
      status: "error",
      cmd: "rtl",
      via: "pilot",
      action: "rth",
      message: "pilot refused rth: no_home",
    });
    expect(outcome).toEqual({
      acknowledged: true,
      accepted: false,
      resultCode: null,
      message: "pilot refused rth: no_home",
    });
  });

  it("still reads a body with neither an ack nor the pilot's verdict as unacknowledged", () => {
    expect(decodeAgentCommandOutcome({ status: "ok" })).toMatchObject({ acknowledged: false, accepted: false });
  });
});
