/**
 * The flight conditions card shows only the wind the METAR reported: no wind
 * group is unknown, not calm, and a variable direction is not north.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { parseAwcMetar } from "@/lib/environment/metar-parser";
import { formatWind } from "@/components/history/detail/tabs/overview/ConditionsCard";

describe("METAR wind on the conditions card", () => {
  it("shows a variable wind as VRB, not 0°", () => {
    expect(formatWind(parseAwcMetar({ icaoId: "VOBL", wdir: "VRB", wspd: 5 }))).toBe("VRB @ 5 kt");
  });

  it("shows a report without a wind group as unknown, not calm", () => {
    expect(formatWind(parseAwcMetar({ icaoId: "VOBL" }))).toBe("—");
  });

  it("shows 0 kt as calm and a steady wind with its gust", () => {
    expect(formatWind(parseAwcMetar({ icaoId: "VOBL", wdir: 0, wspd: 0 }))).toBe("Calm");
    expect(formatWind(parseAwcMetar({ icaoId: "VOBL", wdir: 270, wspd: 12, wgst: 20 }))).toBe("270° @ 12 kt G20");
  });
});
