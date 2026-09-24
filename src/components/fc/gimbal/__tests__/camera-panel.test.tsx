/**
 * @license GPL-3.0-only
 *
 * The Camera panel's manual trigger reports a capture only when the vehicle
 * acknowledged the trigger command, and its type list carries ArduPilot's own
 * CAM1_TYPE values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent, act } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { CameraPanel } from "../CameraPanel";
import { CAM_TYPE_OPTIONS } from "../camera-constants";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";

const toast = vi.fn();
const cameraTrigger = vi.fn<() => Promise<CommandResult>>();
const protocol: Pick<DroneProtocol, "cameraTrigger"> = { cameraTrigger };

vi.mock("@/hooks/use-fc-panel-state", () => ({
  useFcPanelState: () => ({
    params: new Map([["CAM1_TYPE", 1]]),
    loading: false,
    error: null,
    dirtyParams: new Set<string>(),
    hasRamWrites: false,
    loadProgress: null,
    hasLoaded: true,
    getProtocol: () => protocol,
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(),
    commitToFlash: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ label: (s: string) => s }) }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({
  useFlashCommitToast: () => ({ showFlashResult: vi.fn() }),
}));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CameraPanel />
    </NextIntlClientProvider>,
  );
}

async function pressTrigger() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Trigger Camera/ }));
  });
}

describe("CameraPanel · manual trigger", () => {
  beforeEach(() => {
    toast.mockReset();
    cameraTrigger.mockReset();
  });

  it("sends the trigger and counts an acknowledged capture", async () => {
    cameraTrigger.mockResolvedValue({ success: true, resultCode: 0, message: "" });
    renderPanel();
    await pressTrigger();
    expect(cameraTrigger).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Images: 1")).toBeInTheDocument();
  });

  it("counts nothing and reports the refusal when the vehicle rejects it", async () => {
    cameraTrigger.mockResolvedValue({ success: false, resultCode: 4, message: "denied" });
    renderPanel();
    await pressTrigger();
    expect(screen.getByText("Images: 0")).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("denied", "error");
  });
});

describe("ArduPilot CAM1_TYPE values", () => {
  it("names 6 MAVLinkCamV2 and 7 Scripting", () => {
    const label = (v: string) => CAM_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";
    expect(label("6")).toContain("MAVLinkCamV2");
    expect(label("7")).toContain("Scripting");
  });
});
