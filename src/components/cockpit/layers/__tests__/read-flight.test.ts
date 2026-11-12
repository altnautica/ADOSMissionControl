/**
 * @license GPL-3.0-only
 *
 * A loaded mission previews in the AR layout only while the vehicle is known
 * to be disarmed (or the pilot or FC mode owns the flight): an unknown arm
 * state may be a vehicle in the air.
 */

import { afterEach, describe, expect, it } from "vitest";

import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import { readFlight } from "@/components/cockpit/layers/LayerStack";
import type { FlightContext } from "@/lib/cockpit/layers/engine-types";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "node:read-flight-test";
const base = parsePilotState(pilotFixture)!;

function showLoaded(p: Partial<PilotState>): boolean {
  useNavStreamStore.setState({
    byDrone: { [DRONE]: { pilot: { data: { ...base, owner: "gcs", ...p }, receivedAt: Date.now() } } } as never,
  });
  const out = {} as FlightContext;
  readFlight(DRONE, out);
  return out.showLoaded;
}

afterEach(() => useNavStreamStore.setState({ byDrone: {} }));

describe("readFlight", () => {
  it("previews a loaded mission only while known disarmed", () => {
    expect(showLoaded({ armed: false })).toBe(true);
    expect(showLoaded({ armed: true })).toBe(false);
    expect(showLoaded({ armed: null })).toBe(false);
  });
});
