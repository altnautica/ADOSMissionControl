/**
 * P5 binding-UX behaviors: the Cockpit enable toggle flips its store, a
 * gamepad button remapped onto a slot dispatches that slot's skill, a saved
 * preset can be recalled with its bindings intact, and a v36-persisted loadout
 * survives a reload through the settings migration (no reseed when already at
 * the current version).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The Cockpit flag store persists to window.localStorage via its own persist
// middleware, capturing window.localStorage at module-eval time. happy-dom does
// not ship a writable localStorage, so install an in-memory implementation in a
// vi.hoisted block (which runs before any import is evaluated) so the store
// closes over a storage whose setItem actually works.
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

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
import {
  cloneDefaultLoadout,
  DEFAULT_LOADOUT_ID,
} from "@/stores/settings/keybindings-slice";
import { migrateSettings } from "@/stores/settings-store/migrations";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useSkillRegistry } from "@/lib/skills/registry";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";

function resetLoadouts(): void {
  useSettingsStore.setState({
    loadouts: { [DEFAULT_LOADOUT_ID]: cloneDefaultLoadout() },
    activeLoadoutId: DEFAULT_LOADOUT_ID,
  });
}

describe("Cockpit enable toggle", () => {
  beforeEach(() => useCockpitStore.setState({ enabled: false }));

  it("setEnabled flips the gate", () => {
    expect(useCockpitStore.getState().enabled).toBe(false);
    useCockpitStore.getState().setEnabled(true);
    expect(useCockpitStore.getState().enabled).toBe(true);
  });

  it("toggle inverts the gate", () => {
    useCockpitStore.getState().toggle();
    expect(useCockpitStore.getState().enabled).toBe(true);
    useCockpitStore.getState().toggle();
    expect(useCockpitStore.getState().enabled).toBe(false);
  });
});

describe("gamepad remap dispatches the bound skill", () => {
  beforeEach(() => {
    resetLoadouts();
    useDroneManager.setState({ selectedDroneId: "drone-x" });
    // Reset input buttons to all-off.
    useInputStore.getState().setButtons(new Array(16).fill(false));
  });

  it("a button bound to a slot resolves to that slot's skill", () => {
    // Simulate the dispatcher's resolution path: a button edge looks up the
    // active loadout slot whose gamepadButton matches and reads its skillId.
    useSettingsStore
      .getState()
      .setSlotGamepadButton(DEFAULT_LOADOUT_ID, 0, 7); // arm -> button 7

    const { loadouts, activeLoadoutId } = useSettingsStore.getState();
    const loadout = loadouts[activeLoadoutId];
    const slot = loadout.slots.find(
      (s) => s.gamepadButton === 7 && s.skillId !== null,
    );
    expect(slot?.skillId).toBe("arm");
    // And button 7 is now unique to that slot (last-write-wins clears dupes).
    expect(loadout.slots.filter((s) => s.gamepadButton === 7)).toHaveLength(1);
  });

  it("rebinding a button away from a slot removes the old resolution", () => {
    const s = useSettingsStore.getState();
    // Default: arm on button 0. Move button 0 to the kill slot (index 9).
    s.setSlotGamepadButton(DEFAULT_LOADOUT_ID, 9, 0);
    const slots = useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].slots;
    // Now button 0 resolves to kill, not arm.
    const resolved = slots.find(
      (sl) => sl.gamepadButton === 0 && sl.skillId !== null,
    );
    expect(resolved?.skillId).toBe("kill");
  });
});

describe("preset save and recall", () => {
  beforeEach(() => resetLoadouts());

  it("a saved preset keeps its bindings when recalled", () => {
    const s = useSettingsStore.getState();
    // Edit the default, snapshot it into a preset, then mutate the default.
    s.setSlotKey(DEFAULT_LOADOUT_ID, 0, "g");
    const id = useSettingsStore.getState().createLoadout("Saved", DEFAULT_LOADOUT_ID);

    // Mutate the default away from the snapshot.
    useSettingsStore.getState().setSlotKey(DEFAULT_LOADOUT_ID, 0, "h");

    // Recall the preset: its slot 0 key is still "g".
    useSettingsStore.getState().setActiveLoadout(id);
    const active = useSettingsStore.getState();
    const slot0 = active.loadouts[active.activeLoadoutId].slots.find(
      (sl) => sl.index === 0,
    );
    expect(slot0?.key).toBe("g");
  });
});

describe("loadout persistence across reload (v36 migrate)", () => {
  it("a v36-persisted loadout is preserved (no reseed)", () => {
    // A persisted payload already at version 36 carrying a custom binding.
    const custom = cloneDefaultLoadout();
    custom.slots[0].key = "ctrl+y";
    const persisted = {
      loadouts: { [DEFAULT_LOADOUT_ID]: custom },
      activeLoadoutId: DEFAULT_LOADOUT_ID,
    } as unknown as Record<string, unknown>;

    const migrated = migrateSettings(persisted, 36) as unknown as {
      loadouts: Record<string, { slots: { index: number; key: string | null }[] }>;
    };
    const slot0 = migrated.loadouts[DEFAULT_LOADOUT_ID].slots.find(
      (s) => s.index === 0,
    );
    expect(slot0?.key).toBe("ctrl+y");
  });

  it("a pre-v36 payload seeds the default loadout", () => {
    const migrated = migrateSettings({} as Record<string, unknown>, 0) as unknown as {
      loadouts: Record<string, unknown>;
      activeLoadoutId: string;
    };
    expect(migrated.loadouts[DEFAULT_LOADOUT_ID]).toBeTruthy();
    expect(migrated.activeLoadoutId).toBe(DEFAULT_LOADOUT_ID);
  });
});

// Touch the registry import so an unused-import lint never fires while keeping
// the suite focused on store-level behavior (full dispatch coverage lives in
// tests/lib/skills/dispatch-gate.test.ts).
describe("registry import sanity", () => {
  it("registry store is constructable", () => {
    expect(useSkillRegistry.getState().skills).toBeInstanceOf(Map);
  });
});
