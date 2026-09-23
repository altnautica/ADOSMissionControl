/**
 * Demo-mode Betaflight OSD config and onboard blackbox flash, with the same
 * contracts as the MSP adapter: reads return the stored layout, writes update
 * it; the flash reports its used size, downloads that many bytes and erases
 * to empty.
 *
 * @license GPL-3.0-only
 */

import type { CommandResult, MspOsdConfig, MspOsdGeneralConfig } from "@/lib/protocol/types";
import type { MspVtxTablePowerLevel } from "@/lib/protocol/msp/msp-decoders-ext";

/** Demo VTX table: a four-level SmartAudio power table. */
const DEMO_VTX_POWER_LEVELS: MspVtxTablePowerLevel[] = [
  { powerNumber: 1, powerValue: 14, powerLabel: "25 " },
  { powerNumber: 2, powerValue: 23, powerLabel: "200" },
  { powerNumber: 3, powerValue: 27, powerLabel: "500" },
  { powerNumber: 4, powerValue: 29, powerLabel: "800" },
];

/** OSD_ITEM_COUNT of the demo firmware. */
const OSD_ITEM_COUNT = 80;
const PROFILE_1 = 1 << 11;

/** osd.h OSD_POS(x, y) for an SD canvas, visible in OSD profile 1 when `shown`. */
function position(x: number, y: number, shown: boolean): number {
  return (x & 0x1f) | ((y & 0x1f) << 5) | (shown ? PROFILE_1 : 0);
}

/** Demo layout: RSSI, battery, crosshairs, flight mode, mAh drawn and warnings shown. */
const DEMO_VISIBLE: Record<number, [number, number]> = {
  0: [8, 1], 1: [12, 1], 2: [13, 6], 7: [13, 11], 12: [1, 12], 21: [9, 10],
};

const FLASH_TOTAL = 16 * 1024 * 1024;

export class MockBfStorage {
  private items = Array.from({ length: OSD_ITEM_COUNT }, (_, id) => {
    const xy = DEMO_VISIBLE[id];
    return { position: xy ? position(xy[0], xy[1], true) : position(1, 1, false) };
  });
  private general: MspOsdGeneralConfig = {
    videoSystem: 1, units: 1, rssiAlarm: 20, capacityWarning: 2200, altAlarm: 100, enabledWarnings: 0xffff,
  };
  private flashUsed = 768 * 1024;

  async getOsdConfig(): Promise<MspOsdConfig> {
    return {
      flags: 0x01,
      ...this.general,
      itemCount: this.items.length,
      osdProfileCount: 3,
      osdProfileIndex: 1,
      items: this.items.map((i) => ({ ...i })),
    };
  }

  async writeOsdLayout(items: Array<{ index: number; position: number }>, general?: MspOsdGeneralConfig): Promise<CommandResult> {
    if (general) this.general = { ...general };
    for (const it of items) {
      if (it.index >= 0 && it.index < this.items.length) this.items[it.index] = { position: it.position };
    }
    return { success: true, resultCode: 0, message: `${items.length} OSD elements saved` };
  }

  async getDataflashSummary(): Promise<{ totalSize: number; usedSize: number; ready: boolean }> {
    return { totalSize: FLASH_TOTAL, usedSize: this.flashUsed, ready: true };
  }

  async downloadBlackbox(onProgress?: (p: { percentComplete: number }) => void): Promise<Uint8Array> {
    const out = new Uint8Array(this.flashUsed);
    for (let i = 0; i < out.length; i++) out[i] = (i * 31 + 7) & 0xff;
    onProgress?.({ percentComplete: 100 });
    return out;
  }

  async eraseDataflash(): Promise<void> {
    this.flashUsed = 0;
  }

  async getVtxPowerLevels(): Promise<MspVtxTablePowerLevel[]> {
    return DEMO_VTX_POWER_LEVELS.map((l) => ({ ...l }));
  }
}
