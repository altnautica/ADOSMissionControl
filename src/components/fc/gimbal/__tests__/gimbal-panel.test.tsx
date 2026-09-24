/**
 * @license GPL-3.0-only
 *
 * The Gimbal panel's manual aim sends the angle to the vehicle, and on PX4 it
 * reads MNT_MODE_IN (mapped from MNT1_TYPE) with PX4's meaning: -1 disables
 * the mount, 0 is Auto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent, act } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { GimbalPanel } from "../GimbalPanel";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";

const setGimbalAngle = vi.fn<(p: number, r: number, y: number) => Promise<CommandResult>>();
const protocol: Pick<DroneProtocol, "setGimbalAngle"> = { setGimbalAngle };
const state = { firmwareType: "ardupilot-copter", params: new Map<string, number>() };

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: state.params,
    loading: false,
    error: null,
    dirtyParams: new Set<string>(),
    hasRamWrites: false,
    loadProgress: null,
    hasLoaded: true,
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(),
    commitToFlash: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: state.firmwareType }),
}));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel(null),
  selectSelectedProtocol: () => protocol,
}));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ label: (s: string) => s }) }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-telemetry-latest", () => ({ useFreshTelemetry: () => null }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => undefined }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({
  useFlashCommitToast: () => ({ showFlashResult: vi.fn() }),
}));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GimbalPanel />
    </NextIntlClientProvider>,
  );
}

describe("GimbalPanel", () => {
  beforeEach(() => {
    setGimbalAngle.mockReset().mockResolvedValue({ success: true, resultCode: 0, message: "" });
  });

  it("sends the aimed pitch when the slider is released", async () => {
    state.firmwareType = "ardupilot-copter";
    state.params = new Map([["MNT1_TYPE", 1]]);
    renderPanel();
    const pitch = screen.getByLabelText("Gimbal pitch");
    fireEvent.change(pitch, { target: { value: "-45" } });
    await act(async () => {
      fireEvent.pointerUp(pitch);
    });
    expect(setGimbalAngle).toHaveBeenCalledWith(-45, 0, 0);
  });

  it("treats PX4 MNT_MODE_IN 0 as an enabled (Auto) mount", () => {
    state.firmwareType = "px4";
    state.params = new Map([["MNT1_TYPE", 0]]);
    renderPanel();
    expect(screen.getByText("0 — Auto (RC and MAVLink v2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Gimbal pitch")).toBeInTheDocument();
  });

  it("treats PX4 MNT_MODE_IN -1 as a disabled mount", () => {
    state.firmwareType = "px4";
    state.params = new Map([["MNT1_TYPE", -1]]);
    renderPanel();
    expect(screen.queryByLabelText("Gimbal pitch")).toBeNull();
  });
});
