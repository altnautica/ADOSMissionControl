import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fleetHeroFailureReason, setFleetHero } from "@/lib/api/ground-station/fleet";
import { GroundStationApiError, type RequestContext } from "@/lib/api/ground-station/request";

const ctx: RequestContext = { baseUrl: "http://gs.test.local", apiKey: "test-key" };

// The agent's hero route body (`outcome_body` in ados-control's
// gs_fleet_hero route): the selected hero plus one row per registered slot.
const PARTIAL_BODY = {
  hero: "drone-b",
  slots: [
    { slot: 1, device_id: "drone-a", profile: "thumbnail", ok: false, pending: false, error: "timed out" },
    { slot: 2, device_id: "drone-b", profile: "hero", ok: true, pending: false, error: null },
    { slot: 3, device_id: "drone-c", profile: "thumbnail", ok: false, pending: true, error: null },
  ],
};

const HERO_FAILED_BODY = {
  hero: "drone-b",
  slots: [
    { slot: 2, device_id: "drone-b", profile: "hero", ok: false, pending: false, error: "encoder busy" },
  ],
};

describe("setFleetHero", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves a 207 with the agent's per-slot body", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(PARTIAL_BODY), { status: 207 })),
    ) as unknown as typeof fetch;
    const result = await setFleetHero(ctx, "drone-b");
    expect(result.hero).toBe("drone-b");
    expect(result.slots.map((s) => [s.slot, s.profile, s.pending])).toEqual([
      [1, "thumbnail", false],
      [2, "hero", false],
      [3, "thumbnail", true],
    ]);
  });
});

describe("fleetHeroFailureReason", () => {
  it("names the hero row's own error from a 502 body", () => {
    const err = new GroundStationApiError(502, JSON.stringify(HERO_FAILED_BODY));
    expect(fleetHeroFailureReason(err)).toBe("encoder busy");
  });

  it("falls back to the error message for a body without slots", () => {
    const err = new GroundStationApiError(404, JSON.stringify({ code: "E_PROFILE_MISMATCH" }));
    expect(fleetHeroFailureReason(err)).toBe(err.message);
  });
});
