/**
 * @license GPL-3.0-only
 *
 * A picked map point offers Fly here on the flight-controller route only
 * while the FC flies GUIDED, the one mode the send takes it in. In AUTO or
 * LOITER, with no pilot offering a goto, the point offers no Fly here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flyHereRoute, mapPointOffer } from "../map-point";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "d-guided-offer";

beforeEach(() => {
  useNavStreamStore.setState({ byDrone: {} });
  useDroneManager.setState({ selectedDroneId: DRONE });
  useDroneStore.setState({ connectionState: "armed", armState: "armed" });
});

afterEach(() => {
  useDroneManager.setState({ selectedDroneId: null });
});

describe("Fly here on the flight-controller route", () => {
  it.each(["LOITER", "AUTO"] as const)("is not offered in %s with no pilot goto", (mode) => {
    useDroneStore.setState({ flightMode: mode });
    expect(flyHereRoute(DRONE)).toBeNull();
    expect(mapPointOffer(DRONE).flyHere).toBe(false);
  });

  it("is offered in GUIDED", () => {
    useDroneStore.setState({ flightMode: "GUIDED" });
    expect(flyHereRoute(DRONE)).toBe("fc");
    expect(mapPointOffer(DRONE).flyHere).toBe(true);
  });
});
