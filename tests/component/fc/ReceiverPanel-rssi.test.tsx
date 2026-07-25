/**
 * The receiver panel's RSSI readout defaulted an unreceived signal strength to
 * 0, so a panel opened before any RC frame arrived displayed "RSSI 0 (0%)".
 * That reads as a receiver reporting a dead link rather than as a panel that
 * has heard nothing yet, and it is the reading an operator would act on. These
 * tests pin that an absent reading reads as unknown while a real one, including
 * a genuine zero, still renders.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { useTelemetryStore } from "@/stores/telemetry-store";

// The panel drives a real FC over the protocol + param hooks. Neither is under
// test here, so both are stubbed down to the minimum the render path needs.
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) =>
    sel({ getSelectedProtocol: () => ({ setParameter: vi.fn() }) }),
}));

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>(),
    loading: false,
    error: null,
    dirtyParams: new Set<string>(),
    hasRamWrites: false,
    loadProgress: 1,
    hasLoaded: true,
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(),
    commitToFlash: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));

import { ReceiverPanel } from "@/components/fc/receiver/ReceiverPanel";

function seedRc(rssi: number) {
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  s.rc.push({
    timestamp: Date.now(),
    channels: [1500, 1500, 1000, 1500],
    rssi,
  });
}

beforeEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
});

describe("ReceiverPanel RSSI readout", () => {
  it("shows the reported signal strength and its percentage", () => {
    seedRc(255);
    const { container } = renderWithIntl(<ReceiverPanel />);
    expect(container.textContent).toContain("255");
    expect(container.textContent).toContain("100%");
  });

  it("reads unknown when no RC frame has arrived", () => {
    const { container } = renderWithIntl(<ReceiverPanel />);
    expect(container.textContent).toContain("no RC telemetry");
    expect(container.textContent).not.toContain("(0%)");
  });

  it("keeps a genuine zero reading distinct from an absent one", () => {
    // A receiver that really reports 0 is a dead link worth showing as 0.
    seedRc(0);
    const { container } = renderWithIntl(<ReceiverPanel />);
    expect(container.textContent).toContain("(0%)");
    expect(container.textContent).not.toContain("no RC telemetry");
  });
});
