import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCockpitInput } from "@/hooks/use-cockpit-input";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useInputStore } from "@/stores/input-store";
import { useVideoStreamsStore, type StreamDescriptor } from "@/stores/video-streams-store";
import { COCKPIT_GAMEPAD_BUTTON } from "@/lib/skills/chord";

const DRONE = "node:d1";

function leg(id: string, index: number): StreamDescriptor {
  return { id, index, label: id, kind: "concurrent", address: { whepPath: `${id}/whep` } };
}

function pressButton(button: number) {
  const down = Array<boolean>(16).fill(false);
  down[button] = true;
  useInputStore.setState({ buttons: down });
  useInputStore.setState({ buttons: Array<boolean>(16).fill(false) });
}

describe("useCockpitInput", () => {
  beforeEach(() => {
    useInputStore.setState({ buttons: Array<boolean>(16).fill(false) });
    useSkillInputStore.setState({ editorOpen: false, paletteOpen: false, radialOpen: false });
    useFlyQuickSettingsStore.getState().close();
    useVideoStreamsStore.getState().clear();
    useVideoStreamsStore.getState().setStreams(DRONE, [leg("eo", 1), leg("ir", 2)]);
  });
  afterEach(cleanup);

  it("Escape closes the editor before an earlier-registered shell listener sees it", () => {
    // The shell registers its immersive-exit listener first (bubble phase).
    const shellExit = vi.fn();
    const shellHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") shellExit();
    };
    window.addEventListener("keydown", shellHandler);
    try {
      renderHook(() => useCockpitInput({ droneId: DRONE, cockpitEnabled: true }));
      useSkillInputStore.getState().setEditorOpen(true);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(useSkillInputStore.getState().editorOpen).toBe(false);
      expect(shellExit).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", shellHandler);
    }
  });

  it("the D-pad does not switch the main stream while the radial owns it", () => {
    renderHook(() => useCockpitInput({ droneId: DRONE, cockpitEnabled: true }));
    useSkillInputStore.getState().setRadialOpen(true);
    pressButton(COCKPIT_GAMEPAD_BUTTON.dpadRight);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("eo");

    useSkillInputStore.getState().setRadialOpen(false);
    pressButton(COCKPIT_GAMEPAD_BUTTON.dpadRight);
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe("ir");
  });

  it("Shift+comma opens quick settings whatever character the layout produces", () => {
    renderHook(() => useCockpitInput({ droneId: DRONE, cockpitEnabled: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "<", code: "Comma", shiftKey: true }),
    );
    expect(useFlyQuickSettingsStore.getState().isOpen).toBe(true);
  });
});
