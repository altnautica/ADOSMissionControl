/**
 * A flight controller's command result reaches the operator in the cockpit
 * spec's `mav_result.*` words, whether the ack came over the direct link's
 * command queue or through the agent's command route.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import strings from "@/lib/cockpit-spec/setup-strings.json";
import { decodeAgentCommandOutcome } from "@/lib/agent/agent-client/system/commands";
import { mavResultText } from "@/lib/cockpit/spec-strings";
import { CommandQueue, MAV_RESULT } from "@/lib/protocol/command-queue";

const TEXT = strings.strings as Record<string, string>;
const MAV_CMD_COMPONENT_ARM_DISARM = 400;

async function ackWith(result: number): Promise<string> {
  const queue = new CommandQueue(1000);
  const pending = queue.sendCommand(MAV_CMD_COMPONENT_ARM_DISARM, [1, 0, 0, 0, 0, 0, 0], () => {}, 1, 1, 255, 190);
  queue.handleAck(MAV_CMD_COMPONENT_ARM_DISARM, result, 1, 255, 190);
  return (await pending).message;
}

describe("MAV_RESULT text", () => {
  it("reads a result name, bare or prefixed, as the spec's text", () => {
    expect(mavResultText("TEMPORARILY_REJECTED")).toBe(TEXT["mav_result.TEMPORARILY_REJECTED"]);
    expect(mavResultText("MAV_RESULT_DENIED")).toBe(TEXT["mav_result.DENIED"]);
    expect(mavResultText("NOT_A_RESULT")).toBeNull();
  });

  it("words a final command ack in the spec's text", async () => {
    expect(await ackWith(MAV_RESULT.DENIED)).toBe(TEXT["mav_result.DENIED"]);
    expect(await ackWith(MAV_RESULT.UNSUPPORTED)).toBe(TEXT["mav_result.UNSUPPORTED"]);
  });

  it("words the agent's ack result name in the spec's text", () => {
    const outcome = decodeAgentCommandOutcome({
      ack: { observed: true, accepted: false, result: 1, result_name: "TEMPORARILY_REJECTED" },
    });
    expect(outcome.message).toBe(TEXT["mav_result.TEMPORARILY_REJECTED"]);
  });

  it("keeps the flight controller's own status text over the result name", () => {
    const outcome = decodeAgentCommandOutcome({
      ack: { observed: true, accepted: false, result: 2, result_name: "DENIED", statustext: "PreArm: GPS" },
    });
    expect(outcome.message).toBe("PreArm: GPS");
  });
});
