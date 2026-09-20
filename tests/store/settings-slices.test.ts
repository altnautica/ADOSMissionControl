/**
 * Smoke tests for the persisted settings store, exercising each
 * domain slice through the aggregator hook. One small section per
 * slice asserts the slice's defaults and one synchronous setter so
 * a future split of any slice cannot drift its public surface.
 *
 * The persist middleware writes to IndexedDB through idb-keyval.
 * Tests rely on the project-level mock at tests/__mocks__/idb-keyval.ts
 * and assert state via getState() before any async hydration runs.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(async () => {
      store.clear();
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    entries: vi.fn(async () => Array.from(store.entries())),
  };
});

import { useSettingsStore } from "@/stores/settings-store";

describe("settings store slices", () => {
  describe("display slice", () => {
    it("initial state surfaces display defaults", () => {
      const s = useSettingsStore.getState();
      expect(s.mapTileSource).toBe("satellite");
      expect(s.units).toBe("metric");
      expect(s.themeMode).toBe("dark");
      expect(s.accentColor).toBe("blue");
      expect(s.locale).toBe("en");
      expect(s.audioVolume).toBeCloseTo(0.7);
      expect(s.batteryWarningPct).toBe(30);
      expect(s.batteryCriticalPct).toBe(20);
    });

    it("setUnits flips between metric and imperial", () => {
      useSettingsStore.getState().setUnits("imperial");
      expect(useSettingsStore.getState().units).toBe("imperial");
      useSettingsStore.getState().setUnits("metric");
      expect(useSettingsStore.getState().units).toBe("metric");
    });

    it("toggleFavorite adds and removes a param name", () => {
      useSettingsStore.setState({ favoriteParams: [] });
      useSettingsStore.getState().toggleFavorite("RTL_ALT");
      expect(useSettingsStore.getState().favoriteParams).toEqual(["RTL_ALT"]);
      expect(useSettingsStore.getState().isFavorite("RTL_ALT")).toBe(true);
      useSettingsStore.getState().toggleFavorite("RTL_ALT");
      expect(useSettingsStore.getState().favoriteParams).toEqual([]);
    });

    it("custom tile setters trim the URL and clamp the max zoom", () => {
      useSettingsStore.getState().setCustomTileUrl("  http://tiles.lan/{z}/{x}/{y}.png  ");
      useSettingsStore.getState().setCustomTileMaxZoom(99);
      expect(useSettingsStore.getState().customTileUrl).toBe("http://tiles.lan/{z}/{x}/{y}.png");
      expect(useSettingsStore.getState().customTileMaxZoom).toBe(24);
    });
  });

  describe("network slice", () => {
    it("initial state surfaces network defaults", () => {
      const s = useSettingsStore.getState();
      expect(s.autoReconnect).toBe(true);
      expect(s.autoConnectOnLoad).toBe(true);
      expect(s.locationEnabled).toBe(false);
    });

    it("setLocationEnabled toggles the gps-share flag", () => {
      useSettingsStore.getState().setLocationEnabled(true);
      expect(useSettingsStore.getState().locationEnabled).toBe(true);
      useSettingsStore.getState().setLocationEnabled(false);
      expect(useSettingsStore.getState().locationEnabled).toBe(false);
    });
  });

  describe("auth slice", () => {
    it("auth slice contributes no fields today", () => {
      const s = useSettingsStore.getState() as unknown as Record<string, unknown>;
      expect(s.authToken).toBeUndefined();
      expect(s.session).toBeUndefined();
      expect(s.signInState).toBeUndefined();
    });
  });

  describe("command-tab slice", () => {
    it("initial state surfaces command-tab defaults", () => {
      const s = useSettingsStore.getState();
      expect(s.lastActivePanel).toBe("outputs");
      expect(s.panelScrollPositions).toEqual({});
    });

    it("setLastActivePanel updates the active panel id", () => {
      useSettingsStore.getState().setLastActivePanel("failsafe");
      expect(useSettingsStore.getState().lastActivePanel).toBe("failsafe");
      useSettingsStore.getState().setLastActivePanel("outputs");
    });

    it("setPanelScrollPosition records the offset for one panel", () => {
      useSettingsStore.setState({ panelScrollPositions: {} });
      useSettingsStore.getState().setPanelScrollPosition("pid", 240);
      expect(useSettingsStore.getState().panelScrollPositions).toEqual({
        pid: 240,
      });
    });
  });

  describe("video slice", () => {
    it("initial state surfaces video defaults", () => {
      const s = useSettingsStore.getState();
      expect(s.videoWhepUrl).toBe("");
      expect(s.videoTransportMode).toBe("auto");
      expect(s.hudAutoClaimPicOnFirstButton).toBe(false);
    });

    it("setVideoTransportMode flips between auto, lan-whep, p2p-mqtt, off", () => {
      useSettingsStore.getState().setVideoTransportMode("lan-whep");
      expect(useSettingsStore.getState().videoTransportMode).toBe("lan-whep");
      useSettingsStore.getState().setVideoTransportMode("p2p-mqtt");
      expect(useSettingsStore.getState().videoTransportMode).toBe("p2p-mqtt");
      useSettingsStore.getState().setVideoTransportMode("off");
      expect(useSettingsStore.getState().videoTransportMode).toBe("off");
      useSettingsStore.getState().setVideoTransportMode("auto");
    });

    it("setVideoWhepUrl writes the configured endpoint", () => {
      useSettingsStore.getState().setVideoWhepUrl("http://drone.local:8889/whep");
      expect(useSettingsStore.getState().videoWhepUrl).toBe(
        "http://drone.local:8889/whep",
      );
      useSettingsStore.getState().setVideoWhepUrl("");
    });
  });
});
