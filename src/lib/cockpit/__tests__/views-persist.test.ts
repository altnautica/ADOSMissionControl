/**
 * The cockpit view and the Split divider per vehicle survive a reload: they
 * are written to local storage and read back (clamped to the spec range).
 *
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it } from "vitest";

import { useCockpitViewStore } from "@/lib/cockpit/views";

const KEY = "altcmd:cockpit-views";

afterEach(() => {
  localStorage.removeItem(KEY);
  useCockpitViewStore.setState({ byDrone: {}, splitByDrone: {} });
});

describe("cockpit view persistence", () => {
  it("writes the split ratio and the view per vehicle", () => {
    useCockpitViewStore.getState().setSplit("d1", 0.62);
    useCockpitViewStore.getState().setView("d1", "split");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.state).toMatchObject({ splitByDrone: { d1: 0.62 }, byDrone: { d1: "split" } });
  });

  it("restores the split ratio after a reload, clamped to the spec range", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { byDrone: { d2: "split" }, splitByDrone: { d2: 0.4, d3: 5 } }, version: 0 }));
    await useCockpitViewStore.persist.rehydrate();
    const s = useCockpitViewStore.getState();
    expect(s.splitByDrone.d2).toBe(0.4);
    expect(s.splitByDrone.d3).toBe(0.7);
    expect(s.byDrone.d2).toBe("split");
  });

  it("writes a versioned record", () => {
    useCockpitViewStore.getState().setView("d1", "map");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.version).toBe(1);
  });

  it("drops a view id the spec does not name from an unversioned record", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { byDrone: { d4: "foo", d5: "map" }, splitByDrone: { d4: "wide" } }, version: 0 }),
    );
    await useCockpitViewStore.persist.rehydrate();
    const s = useCockpitViewStore.getState();
    expect(s.byDrone).toEqual({ d5: "map" });
    expect(s.splitByDrone).toEqual({});
  });

  it("drops a view id the spec does not name from a current record", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { byDrone: { d6: "cinema", d7: "vision" }, splitByDrone: {} }, version: 1 }));
    await useCockpitViewStore.persist.rehydrate();
    expect(useCockpitViewStore.getState().byDrone).toEqual({ d7: "vision" });
  });
});
