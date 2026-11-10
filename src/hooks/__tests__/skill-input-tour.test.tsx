/**
 * While the controller tour shows, pad presses drive the tour and never fire
 * a bound skill; keyboard bindings keep working.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../locales/en.json";
import type * as Skills from "@/lib/skills";

const { activateSpy } = vi.hoisted(() => ({
  activateSpy: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));
vi.mock("@/lib/skills", async () => {
  const actual = await vi.importActual<typeof Skills>("@/lib/skills");
  return { ...actual, activate: activateSpy, activateBound: activateSpy };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useSkillInput } from "@/hooks/use-skill-input";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useControlsStore } from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDroneManager } from "@/stores/drone-manager";
import { DEFAULT_LOADOUT_ID, cloneDefaultLoadout } from "@/stores/settings/keybindings-slice";

function Dispatcher() {
  useSkillInput();
  return null;
}

function pressPad(index: number): void {
  const buttons = Array.from({ length: 16 }, () => false);
  act(() => useInputStore.setState({ buttons: [...buttons] }));
  buttons[index] = true;
  act(() => useInputStore.setState({ buttons: [...buttons] }));
}

let releaseSurface: () => void = () => {};

describe("skill input while the controller tour shows", () => {
  beforeEach(() => {
    activateSpy.mockClear();
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    const loadout = cloneDefaultLoadout();
    loadout.slots = loadout.slots.map((s) => (s.skillId === "rth" ? { ...s, gamepadButton: 3 } : s));
    useSettingsStore.setState({ loadouts: { [DEFAULT_LOADOUT_ID]: loadout }, activeLoadoutId: DEFAULT_LOADOUT_ID });
    useInputStore.setState({ buttons: [] });
    releaseSurface = useSkillInputStore.getState().acquireSurface();
  });
  afterEach(() => {
    cleanup();
    releaseSurface();
    useControlsStore.setState({ tourVisible: false });
    useDroneManager.setState({ selectedDroneId: null });
  });

  function mount(): void {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Dispatcher />
      </NextIntlClientProvider>,
    );
  }

  it("fires a pad-bound skill when the tour is hidden", () => {
    mount();
    pressPad(3);
    expect(activateSpy).toHaveBeenCalledTimes(1);
    expect(activateSpy.mock.calls[0][0]).toBe("rth");
  });

  it("ignores the pad while the tour shows", () => {
    useControlsStore.setState({ tourVisible: true });
    mount();
    pressPad(3);
    expect(activateSpy).not.toHaveBeenCalled();
  });
});
