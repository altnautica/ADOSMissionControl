/**
 * The mission a mock vehicle holds onboard, with the transfer contract of the
 * real adapter: an upload replaces it, a clear empties it, a download returns
 * it. A demo drone's engine loads the loop it flies; a mock nothing loaded and
 * nothing uploaded to holds the stock six-item mission.
 *
 * @license GPL-3.0-only
 */

import type { CommandResult, MissionItem } from "@/lib/protocol/types";
import { arduPilotStoredItem } from "@/lib/mission/mission-verify";
import { getMockMission } from "./mock-protocol-data";

/** Transfer latency a download simulates. */
const DOWNLOAD_DELAY_MS = 800;

const copyItems = (items: readonly MissionItem[]): MissionItem[] => items.map((it) => ({ ...it }));

export class MockMission {
  /** `null` until something is loaded or uploaded: then the stock mission. */
  private items: MissionItem[] | null = null;

  /** @param homeSlot whether the firmware keeps home in seq 0 (ArduPilot). */
  constructor(private readonly homeSlot: () => boolean) {}

  /** Seed the onboard mission without a transfer (the demo engine's route). */
  load(items: readonly MissionItem[]): void {
    this.items = copyItems(items);
  }

  clear(): void {
    this.items = [];
  }

  /** An ArduPilot vehicle keeps a location's altitude in whole centimetres. */
  async upload(items: readonly MissionItem[]): Promise<CommandResult> {
    this.items = this.homeSlot() ? items.map(arduPilotStoredItem) : copyItems(items);
    return { success: true, resultCode: 0, message: "Mission uploaded" };
  }

  async download(): Promise<MissionItem[]> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, DOWNLOAD_DELAY_MS);
    await promise;
    return copyItems(this.items ?? getMockMission(this.homeSlot()));
  }
}
