/** Minimap frame selection: GPS fix hold, POSXY source and the operator pin. */

import { describe, expect, it } from "vitest";

import {
  MINIMAP_NO_FIX_HOLD_MS,
  activePosxySource,
  nextNoFixSince,
  resolveMinimapMode,
} from "@/lib/hud/minimap-mode";

const base = { pin: "auto" as const, noFixSince: null, now: 10_000, activePosxy: 3 };

describe("minimap mode", () => {
  it("stays global with a 3D fix and a GPS position source", () => {
    expect(resolveMinimapMode(base)).toEqual({ frame: "global", reason: null });
  });

  it("switches to local only after the fix has been below 3D for more than 2 s", () => {
    let since = nextNoFixSince(null, 2, 1000);
    expect(since).toBe(1000);
    since = nextNoFixSince(since, 1, 2500);
    expect(since).toBe(1000);
    expect(resolveMinimapMode({ ...base, noFixSince: since, now: 1000 + MINIMAP_NO_FIX_HOLD_MS }).frame).toBe(
      "global",
    );
    expect(resolveMinimapMode({ ...base, noFixSince: since, now: 1000 + MINIMAP_NO_FIX_HOLD_MS + 1 })).toEqual({
      frame: "local",
      reason: "noFix",
    });
  });

  it("restarts the hold when a 3D fix returns and ignores an unknown fix", () => {
    expect(nextNoFixSince(1000, 3, 5000)).toBeNull();
    expect(nextNoFixSince(1000, null, 5000)).toBeNull();
    expect(nextNoFixSince(null, 0, 5000)).toBe(5000);
  });

  it("switches to local at once on an ExternalNav or None POSXY source", () => {
    expect(resolveMinimapMode({ ...base, activePosxy: 6 })).toEqual({ frame: "local", reason: "posxySource" });
    expect(resolveMinimapMode({ ...base, activePosxy: 0 })).toEqual({ frame: "local", reason: "posxySource" });
    expect(resolveMinimapMode({ ...base, activePosxy: null }).frame).toBe("global");
  });

  it("honours the operator pin over the automatic rules", () => {
    expect(resolveMinimapMode({ ...base, pin: "local" })).toEqual({ frame: "local", reason: "pinned" });
    expect(resolveMinimapMode({ ...base, pin: "map", activePosxy: 6, noFixSince: 0 })).toEqual({
      frame: "global",
      reason: null,
    });
  });

  it("reads POSXY for the active source set", () => {
    const params = { EK3_SRC1_POSXY: 3, EK3_SRC2_POSXY: 6 };
    expect(activePosxySource(params, 1)).toBe(3);
    expect(activePosxySource(params, 2)).toBe(6);
    expect(activePosxySource(params, 3)).toBeNull();
    expect(activePosxySource(null, 1)).toBeNull();
  });
});
