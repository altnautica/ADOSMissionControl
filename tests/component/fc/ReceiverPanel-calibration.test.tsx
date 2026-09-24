/**
 * The receiver panel captures stick positions for trims and calibration, so
 * it must follow RC frames that arrive after it mounts, drop a frame once it
 * is stale, and never report a trim write the vehicle did not accept as
 * saved.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  setParameter: vi.fn(),
  commitParamsToFlash: vi.fn(),
}));

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const protocol = {
    isConnected: false,
    setParameter: h.setParameter,
    commitParamsToFlash: h.commitParamsToFlash,
  };
  return {
    ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
    useDroneManager: (sel: (s: unknown) => unknown) =>
      sel({ drones: new Map([["d1", { protocol }]]), selectedDroneId: "d1" }),
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>([["RC1_MIN", 1000], ["RC1_TRIM", 1500]]),
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
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));

import { ReceiverPanel } from "@/components/fc/receiver/ReceiverPanel";

const trimButton = () => screen.getByRole("button", { name: /Set Trims to Current/ });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useTelemetryStore.getState().clear();
  h.commitParamsToFlash.mockResolvedValue({ success: true, resultCode: 0, message: "ok" });
});

describe("ReceiverPanel calibration", () => {
  it("follows RC frames pushed after mount and drops a stale one", () => {
    renderWithIntl(<ReceiverPanel />);
    expect(trimButton()).toBeDisabled();
    act(() => {
      // A frame arriving after mount; the version bump is what the store's
      // coalesced per-frame bumper would publish.
      useTelemetryStore.getState().rc.push({ timestamp: Date.now(), channels: [1520, 1480, 1000, 1500], rssi: 200 });
      useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
    });
    expect(trimButton()).toBeEnabled();

    cleanup();
    useTelemetryStore.getState().clear();
    useTelemetryStore.getState().rc.push({ timestamp: Date.now() - 60_000, channels: [1900, 1500, 1000, 1500], rssi: 200 });
    renderWithIntl(<ReceiverPanel />);
    expect(trimButton()).toBeDisabled();
  });

  it("reports a rejected trim write as a failure", async () => {
    h.setParameter.mockResolvedValue({ success: false, resultCode: 4, message: "timeout" });
    useTelemetryStore.getState().rc.push({ timestamp: Date.now(), channels: [1520, 1480, 1000, 1500], rssi: 200 });
    renderWithIntl(<ReceiverPanel />);

    fireEvent.click(trimButton());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); });

    expect(h.setParameter).toHaveBeenCalledWith("RC1_TRIM", 1520);
    const levels = h.toast.mock.calls.map((c) => c[1]);
    expect(levels).toContain("error");
    expect(levels).not.toContain("success");
    expect(useParamSafetyStore.getState().pendingWrites.has("RC1_TRIM")).toBe(false);
  });
});
