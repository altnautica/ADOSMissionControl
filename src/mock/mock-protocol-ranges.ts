/**
 * Demo-mode mode ranges and adjustment ranges, with the same slot semantics
 * as the MSP adapter: reads return every slot, writes fill slots 0..n-1 and
 * clear the rest.
 *
 * @license GPL-3.0-only
 */

import type { CommandResult, MspAdjustmentRange, MspModeBox, MspModeRange } from "@/lib/protocol/types";

const MODE_SLOTS = 20;
const ADJUSTMENT_SLOTS = 30;

/** Betaflight permanent box ids for the modes a typical quad reports. */
const DEMO_BOXES: MspModeBox[] = [
  { id: 0, name: "ARM" }, { id: 1, name: "ANGLE" }, { id: 2, name: "HORIZON" },
  { id: 13, name: "BEEPER" }, { id: 26, name: "BLACKBOX" }, { id: 27, name: "FAILSAFE" },
  { id: 28, name: "AIRMODE" }, { id: 35, name: "FLIP OVER AFTER CRASH" }, { id: 36, name: "PREARM" },
  { id: 39, name: "VTX PIT MODE" }, { id: 46, name: "GPS RESCUE" },
];

const EMPTY_MODE: MspModeRange = { boxId: 0, auxChannel: 0, rangeStart: 900, rangeEnd: 900, modeLogic: 0, linkedTo: 0 };
const EMPTY_ADJUSTMENT: MspAdjustmentRange = {
  slotIndex: 0, auxChannelIndex: 0, rangeStart: 900, rangeEnd: 900, adjustmentFunction: 0, auxSwitchChannelIndex: 0,
};

function fill<T>(items: readonly T[], slots: number, empty: T): T[] {
  return Array.from({ length: slots }, (_, i) => ({ ...(items[i] ?? empty) }));
}

export class MockRanges {
  private modes = fill<MspModeRange>([
    { boxId: 0, auxChannel: 0, rangeStart: 1700, rangeEnd: 2100, modeLogic: 0, linkedTo: 0 },
    { boxId: 1, auxChannel: 1, rangeStart: 900, rangeEnd: 1300, modeLogic: 0, linkedTo: 0 },
    { boxId: 28, auxChannel: 2, rangeStart: 1700, rangeEnd: 2100, modeLogic: 0, linkedTo: 0 },
  ], MODE_SLOTS, EMPTY_MODE);
  private adjustments = fill<MspAdjustmentRange>([], ADJUSTMENT_SLOTS, EMPTY_ADJUSTMENT);

  boxes(): MspModeBox[] { return DEMO_BOXES.map((b) => ({ ...b })); }

  modeRanges(): MspModeRange[] { return this.modes.map((r) => ({ ...r })); }

  setModeRanges(ranges: readonly MspModeRange[]): CommandResult {
    if (ranges.length > MODE_SLOTS) {
      return { success: false, resultCode: -1, message: `This flight controller has ${MODE_SLOTS} mode range slots; ${ranges.length} do not fit` };
    }
    this.modes = fill(ranges, MODE_SLOTS, EMPTY_MODE);
    return { success: true, resultCode: 0, message: `${ranges.length} mode ranges written` };
  }

  adjustmentRanges(): MspAdjustmentRange[] { return this.adjustments.map((r) => ({ ...r })); }

  setAdjustmentRanges(ranges: readonly MspAdjustmentRange[]): CommandResult {
    if (ranges.length > ADJUSTMENT_SLOTS) {
      return { success: false, resultCode: -1, message: `This flight controller has ${ADJUSTMENT_SLOTS} adjustment range slots; ${ranges.length} do not fit` };
    }
    this.adjustments = fill(ranges, ADJUSTMENT_SLOTS, EMPTY_ADJUSTMENT);
    return { success: true, resultCode: 0, message: `${ranges.length} adjustment ranges written` };
  }
}
