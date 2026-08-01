/**
 * @license GPL-3.0-only
 *
 * iNav flies autonomous navigation through AUX mode ranges, the same mechanism
 * arming already uses. These commands used to refuse unconditionally for every
 * MSP firmware while the skill bar still offered them, so an operator could
 * confirm a return-to-home and have nothing happen. These tests pin that the
 * command reaches the aircraft when the mode is assigned to a switch, and that
 * a refusal says which mode is missing rather than blaming MSP in general.
 */

import { describe, it, expect, vi } from "vitest";

import {
  mspReturnToLaunch,
  mspLand,
  mspTakeoff,
  mspPauseMission,
  mspResumeMission,
  mspGuidedGoto,
  type MspCommandContext,
} from "../msp-adapter-commands";
import type { ModeRange } from "../msp/msp-mode-map";
import type { FirmwareType, CommandResult } from "../types";

/** iNav permanent box ids, from its own mode table. */
const BOX_NAV_POSHOLD = 11;
const BOX_NAV_RTH = 45;
const BOX_NAV_WP = 46;
const BOX_NAV_LAUNCH = 47;

function range(boxId: number, auxChannel = 1): ModeRange {
  return { boxId, auxChannel, rangeStart: 1700, rangeEnd: 2100 };
}

function ctxFor(
  firmwareType: FirmwareType | undefined,
  modeRanges: ModeRange[],
): { ctx: MspCommandContext; setAux: ReturnType<typeof vi.fn> } {
  const setAux = vi.fn(() => ({ ok: true as const }));
  const ctx = {
    queue: { send: vi.fn(async () => ({ payload: new Uint8Array() })) },
    modeRanges,
    rc: { setAux },
    firmwareType,
  } as unknown as MspCommandContext;
  return { ctx, setAux };
}

describe("iNav navigation commands over AUX ranges", () => {
  it.each<[string, number, (c: MspCommandContext) => Promise<CommandResult>]>([
    ["return to home", BOX_NAV_RTH, (c) => mspReturnToLaunch(c)],
    ["takeoff", BOX_NAV_LAUNCH, (c) => mspTakeoff(c, 10)],
    ["resume mission", BOX_NAV_WP, (c) => mspResumeMission(c)],
    ["pause mission", BOX_NAV_POSHOLD, (c) => mspPauseMission(c)],
  ])("drives %s through its assigned switch", async (_label, boxId, run) => {
    const { ctx, setAux } = ctxFor("inav", [range(boxId, 2)]);
    const result = await run(ctx);
    expect(result.success).toBe(true);
    // Centre of the configured range, on the channel it is configured on.
    expect(setAux).toHaveBeenCalledWith(2, 1900);
  });

  it("refuses with the missing mode named when no switch is assigned", async () => {
    const { ctx, setAux } = ctxFor("inav", [range(BOX_NAV_POSHOLD)]);
    const result = await mspReturnToLaunch(ctx);
    expect(result.success).toBe(false);
    expect(setAux).not.toHaveBeenCalled();
    // The blanket refusal told the operator nothing actionable.
    expect(result.message).not.toBe("Not supported by MSP firmware");
    expect(result.message).toMatch(/RTH/i);
  });

  it("refuses a landing command by naming what iNav does instead", async () => {
    const { ctx } = ctxFor("inav", [range(BOX_NAV_RTH)]);
    const result = await mspLand(ctx);
    expect(result.success).toBe(false);
    expect(result.message).not.toBe("Not supported by MSP firmware");
    expect(result.message).toMatch(/return/i);
  });

  it("refuses a guided goto by naming the reason", async () => {
    const { ctx } = ctxFor("inav", [range(BOX_NAV_RTH)]);
    const result = await mspGuidedGoto(ctx, 0, 0, 0);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/mission|waypoint/i);
  });

  it("does not drive a switch on a firmware without navigation modes", async () => {
    const { ctx, setAux } = ctxFor("betaflight", [range(BOX_NAV_RTH)]);
    const result = await mspReturnToLaunch(ctx);
    expect(result.success).toBe(false);
    expect(setAux).not.toHaveBeenCalled();
  });

  it("reports not connected before a link exists", async () => {
    const { ctx } = ctxFor("inav", [range(BOX_NAV_RTH)]);
    const offline = { ...ctx, queue: null } as MspCommandContext;
    const result = await mspReturnToLaunch(offline);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not connected/i);
  });

  it("surfaces a channel model refusal rather than reporting success", async () => {
    const { ctx } = ctxFor("inav", [range(BOX_NAV_RTH)]);
    const refusing = {
      ...ctx,
      rc: { setAux: () => ({ ok: false as const, reason: "channel is cut" }) },
    } as unknown as MspCommandContext;
    const result = await mspReturnToLaunch(refusing);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/cut/);
  });
});
