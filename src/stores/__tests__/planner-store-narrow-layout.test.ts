/**
 * @license GPL-3.0-only
 *
 * The planner's saved panel layout on a phone-width window: the inspector is
 * a sheet over the map there, so a saved "inspector open" from a wider window
 * never reopens it on load. Wider windows keep the saved layout.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlannerStore } from "@/stores/planner-store";
import { PLANNER_STORE_KEY } from "@/lib/mission/mission-frame";

function viewport(narrow: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Rehydrate the store from a saved layout. */
async function restore(saved: { inspectorOpen: boolean; dockOpen: boolean }): Promise<void> {
  await usePlannerStore.persist.getOptions().storage?.setItem(PLANNER_STORE_KEY, { state: saved, version: 4 });
  await usePlannerStore.persist.rehydrate();
}

afterEach(() => {
  vi.unstubAllGlobals();
  usePlannerStore.setState({ inspectorOpen: false, dockOpen: false });
});

describe("planner layout restore", () => {
  it("keeps the inspector closed on a phone-width window despite a saved open one", async () => {
    viewport(true);
    usePlannerStore.setState({ inspectorOpen: false });
    await restore({ inspectorOpen: true, dockOpen: true });

    expect(usePlannerStore.getState().inspectorOpen).toBe(false);
    // The rest of the saved layout still applies.
    expect(usePlannerStore.getState().dockOpen).toBe(true);
  });

  it("restores the saved inspector on a wider window", async () => {
    viewport(false);
    await restore({ inspectorOpen: true, dockOpen: false });

    expect(usePlannerStore.getState().inspectorOpen).toBe(true);
  });
});
