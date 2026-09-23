/**
 * The Outputs table shows only what the FC reported: an output whose
 * parameters were not read has no invented 1000-2000/1500 limits, and the
 * "Current" column never shows a PWM sample that stopped arriving.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTelemetryStore } from "@/stores/telemetry-store";

let params = new Map<string, number>();

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-armed-lock", () => ({ useArmedLock: () => ({ isHardBlocked: false, hardBlockMessage: "" }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params, loading: false, error: null, dirtyParams: new Set<string>(), hasRamWrites: false,
    loadProgress: null, hasLoaded: true,
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
const droneState = { getSelectedProtocol: () => ({ getVehicleInfo: () => null }) };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value }: { value: string }) => <div data-testid="fn">{value}</div>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../OutputTimerGroupConfig", () => ({ OutputTimerGroupConfig: () => null }));
vi.mock("../MotorTestSection", () => ({ MotorTestSection: () => null }));
vi.mock("../ServoTestSection", () => ({ ServoTestSection: () => null }));

import { OutputsPanel } from "../OutputsPanel";

function output(n: number, fn: number): [string, number][] {
  return [
    [`SERVO${n}_FUNCTION`, fn], [`SERVO${n}_MIN`, 1100], [`SERVO${n}_MAX`, 1900],
    [`SERVO${n}_TRIM`, 1500], [`SERVO${n}_REVERSED`, 0],
  ];
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  params = new Map([...output(1, 33)]);
});

describe("OutputsPanel", () => {
  it("marks unread outputs instead of inventing their limits", () => {
    render(<OutputsPanel />);
    expect(screen.getAllByTestId("fn")).toHaveLength(1);
    expect(screen.getAllByText(/not read from the FC/)).toHaveLength(15);
  });

  it("does not show a servo sample that stopped arriving as current", () => {
    useTelemetryStore.getState().pushServoOutput({ timestamp: Date.now() - 60_000, port: 0, servos: [1733] });
    render(<OutputsPanel />);
    expect(screen.queryByText("1733")).toBeNull();
  });

  it("shows a fresh servo sample", () => {
    useTelemetryStore.getState().pushServoOutput({ timestamp: Date.now(), port: 0, servos: [1733] });
    render(<OutputsPanel />);
    expect(screen.getByText("1733")).toBeTruthy();
  });
});
