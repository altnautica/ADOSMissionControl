/**
 * @license GPL-3.0-only
 *
 * The telemetry-radio link card shows RADIO_STATUS only while it is fresh,
 * treats 255 as "not reported" and does not present device-scale noise as dBm.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-firmware-capabilities", () => ({ useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }) }));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ label: (c: string) => c }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>(), loading: false, error: null, dirtyParams: new Set<string>(),
    hasRamWrites: false, loadProgress: null, hasLoaded: true,
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
const droneState = { getSelectedProtocol: () => ({}) };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../../shared/ParamEnumSelect", () => ({ ParamEnumSelect: () => null, useParamEnums: () => ({ enumValues: () => [] }) }));
vi.mock("../../parameters/ParamFieldLabel", () => ({ ParamFieldLabel: () => null }));

import { TelRadioPanel } from "../TelRadioPanel";

function pushRadio(ageMs: number, rssi: number) {
  useTelemetryStore.getState().pushRadio({
    timestamp: Date.now() - ageMs,
    rssi,
    remrssi: 190,
    txbuf: 100,
    noise: 40,
    remnoise: 255,
    rxerrors: 0,
    fixed: 0,
    sourceSystemId: 51,
  });
}

beforeEach(() => useTelemetryStore.getState().clear());
afterEach(cleanup);

describe("TelRadioPanel link status", () => {
  it("shows a fresh report without dBm units", () => {
    pushRadio(0, 200);
    render(<TelRadioPanel />);
    expect(screen.getByText("200/254")).toBeTruthy();
    expect(screen.queryByText(/dBm/)).toBeNull();
    expect(screen.getByText(/Remote noise \(device scale\): —/)).toBeTruthy();
  });

  it("does not show a 255 RSSI as a full bar", () => {
    pushRadio(0, 255);
    render(<TelRadioPanel />);
    expect(screen.getByText("Not reported")).toBeTruthy();
    expect(screen.queryByText("255/255")).toBeNull();
  });

  it("drops the last report once RADIO_STATUS goes stale", () => {
    pushRadio(TELEMETRY_STALE_MS + 1_000, 200);
    render(<TelRadioPanel />);
    expect(screen.getByText(/RADIO_STATUS not received recently/)).toBeTruthy();
    expect(screen.queryByText("200/254")).toBeNull();
  });
});
