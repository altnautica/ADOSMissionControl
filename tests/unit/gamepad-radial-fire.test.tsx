/**
 * Behavioral test for the Cockpit gamepad radial firing path: holding the
 * reserved button opens the radial, a d-pad aim highlights a wedge, and
 * releasing the button fires THAT highlighted skill through the shared
 * dispatcher (and only it). Also asserts the radial never fires when nothing is
 * highlighted, and never fires while the path is disabled.
 *
 * Companion to gamepad-radial.test.ts (which covers the wedge geometry); this
 * file proves the wire from aim -> release -> activate.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The settings store persists through idb-keyval; mock it so a setState in the
// test does not reach for a real IndexedDB in the test environment.
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

// Spy on the dispatcher while keeping the registry + context builder real, so
// the wedge list resolves from a genuinely-registered skill. Hoisted so the
// mock factory (also hoisted) can reference it.
const { activateMock } = vi.hoisted(() => ({
  // Typed to the dispatcher signature so call-arg indexing is type-safe.
  activateMock: vi.fn<(skillId: string, ...rest: unknown[]) => Promise<void>>(
    async () => {},
  ),
}));
vi.mock("@/lib/skills", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/skills")>("@/lib/skills");
  return { ...actual, activate: activateMock };
});

import {
  useGamepadRadial,
  RADIAL_GAMEPAD_BUTTON,
} from "@/hooks/use-gamepad-radial";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillRegistry } from "@/lib/skills";
import {
  cloneDefaultLoadout,
  DEFAULT_LOADOUT_ID,
} from "@/stores/settings/keybindings-slice";
import type { Skill, SkillState } from "@/lib/skills/types";

const DPAD_UP = 12;
const DPAD_DOWN = 13;

function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

function builtinSkill(id: string): Skill {
  return {
    id,
    label: `skills.${id}`,
    icon: "Sparkles",
    category: "flight",
    source: "builtin",
    toggle: false,
    getState: () => ({ kind: "idle" }) as SkillState,
    activate: async () => {},
  };
}

/** Set the full button vector with only the named indices pressed. */
function pressButtons(...indices: number[]): void {
  const buttons = new Array(16).fill(false);
  for (const i of indices) buttons[i] = true;
  act(() => {
    useInputStore.getState().setButtons(buttons);
  });
}

function releaseAll(): void {
  act(() => {
    useInputStore.getState().setButtons(new Array(16).fill(false));
  });
}

describe("gamepad radial firing", () => {
  beforeEach(() => {
    activateMock.mockClear();
    clearRegistry();
    releaseAll();
    useDroneManager.setState({ selectedDroneId: "drone-r" });
    // Two bound wedges: aiming up selects the first, down selects the second.
    const loadout = cloneDefaultLoadout();
    loadout.slots = [
      { index: 0, skillId: "alpha", key: null, gamepadButton: null },
      { index: 1, skillId: "bravo", key: null, gamepadButton: null },
    ];
    useSettingsStore.setState({
      loadouts: { [DEFAULT_LOADOUT_ID]: loadout },
      activeLoadoutId: DEFAULT_LOADOUT_ID,
    });
    const reg = useSkillRegistry.getState();
    reg.register(builtinSkill("alpha"));
    reg.register(builtinSkill("bravo"));
  });

  it("fires the highlighted skill on release (d-pad up -> first wedge)", () => {
    const { result } = renderHook(() => useGamepadRadial(true));

    // Hold the radial button: the overlay opens with nothing highlighted.
    pressButtons(RADIAL_GAMEPAD_BUTTON);
    expect(result.current.open).toBe(true);
    expect(result.current.highlightedIndex).toBe(-1);

    // Aim up (d-pad up) -> wedge 0 highlighted, still holding the radial button.
    pressButtons(RADIAL_GAMEPAD_BUTTON, DPAD_UP);
    expect(result.current.highlightedIndex).toBe(0);

    // Release everything: the highlighted skill (alpha) fires once.
    releaseAll();
    expect(result.current.open).toBe(false);
    expect(activateMock).toHaveBeenCalledTimes(1);
    expect(activateMock.mock.calls[0][0]).toBe("alpha");
  });

  it("fires the second wedge when aimed down", () => {
    renderHook(() => useGamepadRadial(true));

    pressButtons(RADIAL_GAMEPAD_BUTTON);
    pressButtons(RADIAL_GAMEPAD_BUTTON, DPAD_DOWN);
    releaseAll();

    expect(activateMock).toHaveBeenCalledTimes(1);
    expect(activateMock.mock.calls[0][0]).toBe("bravo");
  });

  it("does not fire when released with nothing highlighted", () => {
    renderHook(() => useGamepadRadial(true));

    pressButtons(RADIAL_GAMEPAD_BUTTON);
    releaseAll(); // released without ever aiming

    expect(activateMock).not.toHaveBeenCalled();
  });

  it("never opens or fires while the path is disabled", () => {
    const { result } = renderHook(() => useGamepadRadial(false));

    pressButtons(RADIAL_GAMEPAD_BUTTON, DPAD_UP);
    expect(result.current.open).toBe(false);
    releaseAll();

    expect(activateMock).not.toHaveBeenCalled();
  });
});
