/**
 * A fresh pilot state reporting an FC failsafe refuses "Fly here" on both
 * routes: a GUIDED flight controller does not get a reposition that would
 * fight the failsafe RTL or land.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";
import cases from "../fixtures/fly-here-cases.json";
import { parsePilotState } from "../cockpit-frames";
import { flyHereOffered } from "../fly-here-offer";

const failsafe = cases.find((c) => c.name === "fc_failsafe");
const GUIDED_FLYING = { guided: true, armed: true, landed: false };

describe("fly here during an FC failsafe", () => {
  it("does not offer the FC route while a fresh pilot reports the failsafe", () => {
    const p = parsePilotState(failsafe?.input.pilot);
    expect(p?.fcFailsafe).toBe(true);
    expect(flyHereOffered(p, 100, GUIDED_FLYING)).toEqual({ route: null, reason: "failsafe" });
  });

  it("keeps the FC route once the pilot state is stale", () => {
    const p = parsePilotState(failsafe?.input.pilot);
    expect(flyHereOffered(p, 60_000, GUIDED_FLYING)).toEqual({ route: "fc" });
  });
});
