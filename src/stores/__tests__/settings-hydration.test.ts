/**
 * @license GPL-3.0-only
 *
 * Every hydration gate (onboarding, disclaimer, demo residue sweep, location)
 * selects `_hasHydrated` and renders nothing until it flips. The flip has to
 * reach subscribers, or a gate mounted before the persisted read finished
 * stays closed until some unrelated settings write happens to re-render it.
 */

import { describe, it, expect } from "vitest";

import { useSettingsStore } from "../settings-store";

describe("settings hydration", () => {
  it("notifies subscribers that the persisted settings are loaded", async () => {
    useSettingsStore.setState({ _hasHydrated: false });
    const seen: boolean[] = [];
    const unsubscribe = useSettingsStore.subscribe((s) => seen.push(s._hasHydrated));

    await useSettingsStore.persist.rehydrate();
    // The flag lands on a microtask queued by the rehydrate callback.
    await Promise.resolve();
    unsubscribe();

    expect(seen).toContain(true);
    expect(useSettingsStore.getState()._hasHydrated).toBe(true);
  });
});
