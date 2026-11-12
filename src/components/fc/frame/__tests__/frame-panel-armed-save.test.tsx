/**
 * @license GPL-3.0-only
 *
 * The Frame panel's Save is off, with the reason, while a staged frame
 * geometry edit cannot be written because the vehicle may be armed; other
 * frame-panel edits still save.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { FramePanel } from "../FramePanel";

const state = { dirty: new Set<string>() };

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["FRAME_CLASS", 1], ["FRAME_TYPE", 1], ["MOT_PWM_TYPE", 0]]),
    loading: false, error: null, dirtyParams: state.dirty, hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set<string>(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: true, isHardBlocked: true, lockMessage: "", hardBlockMessage: "Disarm first" }),
}));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => undefined }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({
  useFlashCommitToast: () => ({ showFlashResult: vi.fn() }),
}));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel(null),
  selectSelectedProtocol: () => ({}),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function saveButton(): HTMLButtonElement {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FramePanel />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: /save to ram/i }) as HTMLButtonElement;
}

describe("FramePanel Save while the vehicle may be armed", () => {
  it("is off with the reason when a frame edit is staged", () => {
    state.dirty = new Set(["FRAME_CLASS", "MOT_PWM_TYPE"]);
    const save = saveButton();
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Disarm first");
    cleanup();
  });

  it("stays on for an edit that is not frame geometry", () => {
    state.dirty = new Set(["MOT_PWM_TYPE"]);
    expect(saveButton().disabled).toBe(false);
    cleanup();
  });
});
