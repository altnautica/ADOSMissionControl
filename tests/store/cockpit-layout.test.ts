/**
 * Tests for the per-loadout cockpit chrome layout: the default layout shape,
 * the setLoadoutLayout action (partial merge, persistence on the active
 * loadout), layout carry-through on createLoadout, and the v37 migration that
 * backfills the layout onto pre-existing persisted loadouts.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The persist middleware writes through idb-keyval; mock it so the store can
// hydrate/persist without a real IndexedDB in the test environment.
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
import { migrateSettings } from "@/stores/settings-store";
import {
  cloneDefaultLoadout,
  cloneDefaultCockpitLayout,
  DEFAULT_COCKPIT_LAYOUT,
  DEFAULT_LOADOUT_ID,
  type Loadout,
} from "@/stores/settings/keybindings-slice";

function resetLoadouts(): void {
  useSettingsStore.setState({
    loadouts: { [DEFAULT_LOADOUT_ID]: cloneDefaultLoadout() },
    activeLoadoutId: DEFAULT_LOADOUT_ID,
  });
}

describe("cockpit layout slice", () => {
  beforeEach(() => resetLoadouts());

  it("ships the default cockpit layout on the default loadout", () => {
    const loadout = useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID];
    expect(loadout.layout).toEqual(DEFAULT_COCKPIT_LAYOUT);
    expect(loadout.layout).toEqual({ density: "standard" });
    // Density defaults to standard and is carried with the preset.
    expect(loadout.layout.density).toBe("standard");
  });

  it("setLoadoutLayout persists a density change on the active loadout", () => {
    useSettingsStore
      .getState()
      .setLoadoutLayout(DEFAULT_LOADOUT_ID, { density: "minimal" });
    const layout =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout.density).toBe("minimal");
    expect(layout.widgets).toBeUndefined();
  });

  it("createLoadout carries the source loadout's density", () => {
    useSettingsStore
      .getState()
      .setLoadoutLayout(DEFAULT_LOADOUT_ID, { density: "full" });
    const id = useSettingsStore
      .getState()
      .createLoadout("Full-info", DEFAULT_LOADOUT_ID);
    expect(useSettingsStore.getState().loadouts[id].layout.density).toBe("full");
  });

  it("cloneDefaultCockpitLayout returns a fresh, mutation-safe copy", () => {
    const a = cloneDefaultCockpitLayout();
    const b = cloneDefaultCockpitLayout();
    expect(a).toEqual(DEFAULT_COCKPIT_LAYOUT);
    expect(a).not.toBe(DEFAULT_COCKPIT_LAYOUT);
    a.density = "full";
    expect(b.density).toBe("standard");
    expect(DEFAULT_COCKPIT_LAYOUT.density).toBe("standard");
  });

  it("setLoadoutLayout merges a partial onto the loadout layout", () => {
    const store = useSettingsStore.getState();
    store.setLoadoutLayout(DEFAULT_LOADOUT_ID, { pipPosition: { x: 5, y: 6 } });
    const layout =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout.pipPosition).toEqual({ x: 5, y: 6 });
    // Untouched fields are preserved.
    expect(layout.density).toBe("standard");
  });

  it("setLoadoutLayout is a no-op for an unknown loadout id", () => {
    const before = useSettingsStore.getState().loadouts;
    useSettingsStore.getState().setLoadoutLayout("nope", { density: "full" });
    expect(useSettingsStore.getState().loadouts).toEqual(before);
  });

  it("createLoadout carries the source loadout's layout", () => {
    const store = useSettingsStore.getState();
    store.setLoadoutLayout(DEFAULT_LOADOUT_ID, {
      density: "minimal",
      pipPosition: { x: 3, y: 4 },
    });
    const id = useSettingsStore
      .getState()
      .createLoadout("Custom", DEFAULT_LOADOUT_ID);
    const created = useSettingsStore.getState().loadouts[id];
    expect(created.layout.density).toBe("minimal");
    expect(created.layout.pipPosition).toEqual({ x: 3, y: 4 });
    // Distinct object reference from the source (mutation-safe).
    expect(created.layout).not.toBe(
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout,
    );
  });

  it("a fresh loadout from no source gets the default layout", () => {
    const id = useSettingsStore.getState().createLoadout("Blank");
    expect(useSettingsStore.getState().loadouts[id].layout).toEqual(
      DEFAULT_COCKPIT_LAYOUT,
    );
  });
});

describe("setLoadoutWidget (per-widget placement)", () => {
  beforeEach(() => resetLoadouts());

  it("creates the widgets map lazily and records a zone override", () => {
    const layout0 =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout0.widgets).toBeUndefined();

    useSettingsStore
      .getState()
      .setLoadoutWidget(DEFAULT_LOADOUT_ID, "builtin.perception-health", {
        zone: "bottom-right",
      });

    const layout =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout.widgets?.["builtin.perception-health"]).toEqual({
      zone: "bottom-right",
    });
    // The density is untouched.
    expect(layout.density).toBe("standard");
  });

  it("merges partial writes for the same widget (zone then hidden)", () => {
    const store = useSettingsStore.getState();
    store.setLoadoutWidget(DEFAULT_LOADOUT_ID, "builtin.whats-locked", {
      zone: "center",
    });
    store.setLoadoutWidget(DEFAULT_LOADOUT_ID, "builtin.whats-locked", {
      hidden: true,
    });
    expect(
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout.widgets?.[
        "builtin.whats-locked"
      ],
    ).toEqual({ zone: "center", hidden: true });
  });

  it("keeps other widgets' overrides when writing one", () => {
    const store = useSettingsStore.getState();
    store.setLoadoutWidget(DEFAULT_LOADOUT_ID, "a", { zone: "top-left" });
    store.setLoadoutWidget(DEFAULT_LOADOUT_ID, "b", { hidden: true });
    const widgets =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout.widgets;
    expect(widgets?.a).toEqual({ zone: "top-left" });
    expect(widgets?.b).toEqual({ hidden: true });
  });

  it("is a no-op for an unknown loadout id", () => {
    const before = useSettingsStore.getState().loadouts;
    useSettingsStore
      .getState()
      .setLoadoutWidget("nope", "x", { hidden: true });
    expect(useSettingsStore.getState().loadouts).toEqual(before);
  });

  it("carries widget overrides onto a loadout cloned from a source", () => {
    useSettingsStore
      .getState()
      .setLoadoutWidget(DEFAULT_LOADOUT_ID, "builtin.whats-locked", {
        zone: "bottom-center",
      });
    const id = useSettingsStore
      .getState()
      .createLoadout("Custom", DEFAULT_LOADOUT_ID);
    expect(
      useSettingsStore.getState().loadouts[id].layout.widgets?.[
        "builtin.whats-locked"
      ],
    ).toEqual({ zone: "bottom-center" });
  });
});

describe("v37 layout migration", () => {
  it("backfills the default layout onto a pre-v37 loadout lacking it", () => {
    const legacy: Partial<Loadout> = {
      id: DEFAULT_LOADOUT_ID,
      name: "Default",
      slots: [{ index: 0, skillId: "arm", key: "shift+a", gamepadButton: 0 }],
      // no `layout` field (v36 shape)
    };
    const result = migrateSettings(
      { loadouts: { [DEFAULT_LOADOUT_ID]: legacy } },
      36,
    ) as unknown as Record<string, unknown>;
    const loadouts = result.loadouts as Record<string, Loadout>;
    expect(loadouts[DEFAULT_LOADOUT_ID].layout).toEqual(DEFAULT_COCKPIT_LAYOUT);
  });

  it("preserves an existing layout through the v37 migration", () => {
    const existing: Loadout = {
      id: DEFAULT_LOADOUT_ID,
      name: "Default",
      slots: [],
      layout: {
        density: "full",
        pipPosition: { x: 1, y: 2 },
      },
      seededSkillIds: [],
    };
    const result = migrateSettings(
      { loadouts: { [DEFAULT_LOADOUT_ID]: existing } },
      36,
    ) as unknown as Record<string, unknown>;
    const loadouts = result.loadouts as Record<string, Loadout>;
    expect(loadouts[DEFAULT_LOADOUT_ID].layout).toEqual({
      density: "full",
      pipPosition: { x: 1, y: 2 },
    });
  });

  it("v49 records slotted plugin skills as already seeded", () => {
    const legacy: Partial<Loadout> = {
      id: DEFAULT_LOADOUT_ID,
      name: "Default",
      slots: [
        { index: 0, skillId: "arm", key: "shift+a", gamepadButton: 0 },
        { index: 1, skillId: "survey-kit:orbit", key: "g", gamepadButton: null },
        { index: 2, skillId: null, key: null, gamepadButton: null },
      ],
    };
    const result = migrateSettings(
      { loadouts: { [DEFAULT_LOADOUT_ID]: legacy } },
      48,
    ) as unknown as Record<string, unknown>;
    const loadouts = result.loadouts as Record<string, Loadout>;
    expect(loadouts[DEFAULT_LOADOUT_ID].seededSkillIds).toEqual(["survey-kit:orbit"]);
  });

  it("seeds a full default loadout (with layout) when migrating from below v36", () => {
    const result = migrateSettings({}, 30) as unknown as Record<
      string,
      unknown
    >;
    const loadouts = result.loadouts as Record<string, Loadout>;
    expect(loadouts[DEFAULT_LOADOUT_ID].layout).toEqual(DEFAULT_COCKPIT_LAYOUT);
  });
});

describe("v45 density migration", () => {
  it("backfills the default density onto a pre-v45 loadout layout lacking it", () => {
    const legacyLayout = {
      pipPosition: { x: 4, y: 8 },
      // no `density` field (v44 shape)
    };
    const result = migrateSettings(
      {
        loadouts: {
          [DEFAULT_LOADOUT_ID]: {
            id: DEFAULT_LOADOUT_ID,
            name: "Default",
            slots: [],
            layout: legacyLayout,
          },
        },
      },
      44,
    ) as unknown as Record<string, unknown>;
    const loadouts = result.loadouts as Record<string, Loadout>;
    const layout = loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout.density).toBe("standard");
    // Other layout fields are preserved through the backfill.
    expect(layout.pipPosition).toEqual({ x: 4, y: 8 });
  });

  it("preserves an already-set density through the v45 migration", () => {
    const result = migrateSettings(
      {
        loadouts: {
          [DEFAULT_LOADOUT_ID]: {
            id: DEFAULT_LOADOUT_ID,
            name: "Default",
            slots: [],
            layout: {
              topBar: true,
              minimap: true,
              telemetryStrip: false,
              proximityRadar: true,
              density: "minimal",
            },
          },
        },
      },
      44,
    ) as unknown as Record<string, unknown>;
    const loadouts = result.loadouts as Record<string, Loadout>;
    expect(loadouts[DEFAULT_LOADOUT_ID].layout.density).toBe("minimal");
  });
});
