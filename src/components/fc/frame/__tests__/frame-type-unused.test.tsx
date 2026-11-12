/**
 * @license GPL-3.0-only
 *
 * A frame class with no FRAME_TYPE list (ArduCopter Heli) shows the vehicle's
 * own FRAME_TYPE value, never a fabricated "0 — Default", and no type
 * description keyed on the type number alone.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { FramePanel } from "../FramePanel";

const params = new Map<string, number>([["FRAME_CLASS", 6], ["FRAME_TYPE", 1]]);

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params,
    loading: false,
    error: null,
    dirtyParams: new Set<string>(),
    hasRamWrites: false,
    loadProgress: null,
    hasLoaded: true,
    missingOptional: new Set<string>(),
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(),
    commitToFlash: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
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

describe("FramePanel · class without a type list", () => {
  it("shows the vehicle's own FRAME_TYPE, not 0 — Default", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FramePanel />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 — Not used by this frame class")).toBeInTheDocument();
    expect(screen.queryByText("0 — Default")).toBeNull();
  });
});
