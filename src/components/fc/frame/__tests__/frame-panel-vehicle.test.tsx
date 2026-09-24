/**
 * @license GPL-3.0-only
 *
 * The ArduPilot Frame panel edits the frame parameters of the vehicle it is
 * connected to: ArduRover's FRAME_CLASS is Rover/Boat/BalanceBot (not the
 * multirotor classes), and ArduSub selects its thrusters with FRAME_CONFIG.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { FramePanel } from "../FramePanel";

const state = {
  firmwareType: "ardupilot-rover",
  params: new Map<string, number>(),
  requested: [] as string[],
};

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: state.firmwareType }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: (opts: { paramNames: string[] }) => {
    state.requested = opts.paramNames;
    return {
      params: state.params,
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
    };
  },
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

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FramePanel />
    </NextIntlClientProvider>,
  );
}

describe("FramePanel · non-multirotor ArduPilot vehicles", () => {
  beforeEach(() => {
    state.params = new Map();
    state.requested = [];
  });

  it("shows ArduRover's own frame class, never a multirotor class", () => {
    state.firmwareType = "ardupilot-rover";
    state.params = new Map([["FRAME_CLASS", 2], ["FRAME_TYPE", 0]]);
    renderPanel();
    expect(screen.getByText("2 — Boat")).toBeInTheDocument();
    expect(screen.queryByText(/Hexa/)).toBeNull();
    expect(screen.queryByText(/Quad/)).toBeNull();
  });

  it("reads FRAME_CONFIG on ArduSub", () => {
    state.firmwareType = "ardupilot-sub";
    state.params = new Map([["FRAME_CONFIG", 1]]);
    renderPanel();
    expect(state.requested).toEqual(["FRAME_CONFIG"]);
    expect(screen.getByText("1 — Vectored")).toBeInTheDocument();
  });
});
