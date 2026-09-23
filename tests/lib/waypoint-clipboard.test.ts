/**
 * Unit tests for the module-level waypoint clipboard: copy deep-copies in,
 * paste deep-copies out, and both are independent of the stored snapshot.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setClipboard,
  getClipboard,
  hasClipboard,
  clearClipboard,
} from "@/lib/waypoint-clipboard";
import type { Waypoint } from "@/lib/types/mission";

function wp(id: string, lat: number, lon: number): Waypoint {
  return { id, lat, lon, alt: 30 };
}

beforeEach(() => {
  clearClipboard();
});

describe("waypoint clipboard", () => {
  it("starts empty", () => {
    expect(hasClipboard()).toBe(false);
    expect(getClipboard()).toEqual([]);
  });

  it("stores and returns copied waypoints", () => {
    const source = [wp("a", 12.9, 77.6), wp("b", 12.91, 77.61)];
    setClipboard(source);

    expect(hasClipboard()).toBe(true);
    expect(getClipboard()).toEqual(source);
  });

  it("deep-copies on write so a later mutation of the source is not seen", () => {
    const source = [wp("a", 12.9, 77.6)];
    setClipboard(source);
    source[0].lat = 0; // mutate the caller's array after copying

    expect(getClipboard()[0].lat).toBe(12.9);
  });

  it("deep-copies on read so a mutation of the result is not persisted", () => {
    setClipboard([wp("a", 12.9, 77.6)]);
    const read = getClipboard();
    read[0].lat = 99;

    expect(getClipboard()[0].lat).toBe(12.9);
  });

  it("gives each paste its own actions array with fresh action ids", () => {
    const source: Waypoint = {
      ...wp("a", 12.9, 77.6),
      actions: [{ id: "act1", command: "DO_SET_CAM_TRIGG", param1: 20 }],
    };
    setClipboard([source]);
    const first = getClipboard()[0];
    const second = getClipboard()[0];

    expect(first.actions).not.toBe(source.actions);
    expect(first.actions).not.toBe(second.actions);
    const ids = [source, first, second].map((w) => w.actions![0].id);
    expect(new Set(ids).size).toBe(3);
    expect(first.actions![0]).toMatchObject({ command: "DO_SET_CAM_TRIGG", param1: 20 });

    first.actions![0].param1 = 99;
    expect(source.actions![0].param1).toBe(20);
    expect(second.actions![0].param1).toBe(20);
  });

  it("clears back to empty", () => {
    setClipboard([wp("a", 1, 2)]);
    clearClipboard();

    expect(hasClipboard()).toBe(false);
    expect(getClipboard()).toEqual([]);
  });
});
