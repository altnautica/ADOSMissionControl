/**
 * The setup offer store reads the uids an earlier build stored as a bare JSON
 * array under the same key, so an aircraft offered there is not offered again.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";

import { SETUP_OFFERED_KEY, useAircraftSetupOfferStore } from "@/stores/aircraft-setup-offer-store";

afterEach(() => {
  localStorage.clear();
  useAircraftSetupOfferStore.setState({ offered: [] });
});

describe("aircraft setup offers on this device", () => {
  it("keeps the uids an earlier build stored as a bare array", async () => {
    localStorage.setItem(SETUP_OFFERED_KEY, JSON.stringify(["fc-a", "fc-b"]));
    await useAircraftSetupOfferStore.persist.rehydrate();
    expect(useAircraftSetupOfferStore.getState().offered).toEqual(["fc-a", "fc-b"]);
  });

  it("reads the current shape unchanged", async () => {
    localStorage.setItem(SETUP_OFFERED_KEY, JSON.stringify({ state: { offered: ["fc-c"] }, version: 1 }));
    await useAircraftSetupOfferStore.persist.rehydrate();
    expect(useAircraftSetupOfferStore.getState().offered).toEqual(["fc-c"]);
  });

  it("drops anything but strings from a legacy array", async () => {
    localStorage.setItem(SETUP_OFFERED_KEY, JSON.stringify(["fc-d", 7, null]));
    await useAircraftSetupOfferStore.persist.rehydrate();
    expect(useAircraftSetupOfferStore.getState().offered).toEqual(["fc-d"]);
  });

  it("writes the current shape back", () => {
    useAircraftSetupOfferStore.getState().markOffered("fc-e");
    expect(JSON.parse(localStorage.getItem(SETUP_OFFERED_KEY)!)).toEqual({ state: { offered: ["fc-e"] }, version: 1 });
  });
});
