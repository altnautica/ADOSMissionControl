/**
 * @license GPL-3.0-only
 *
 * GPS fix quality is the reading an operator checks before committing to a
 * flight: "3D Fix" and "RTK Fixed" are the difference between metre and
 * centimetre position accuracy. Several surfaces used to name the fix type
 * from a private English table, so every non-English operator read English.
 *
 * These tests pin the two highest-value surfaces to the shared
 * `indicators.gpsFix.*` vocabulary — the GPS indicator and the pre-flight
 * checklist. They render a real GPS_FIX_TYPE and assert the string that the
 * locale file resolves, so a wrong key (or a re-inlined English label) fails
 * here rather than in front of an operator.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { GpsSkyView } from "@/components/indicators/GpsSkyView";
import { PreFlightChecklist } from "@/components/flight/PreFlightChecklist";
import { ReplayTelemetryPanel } from "@/components/history/ReplayTelemetryPanel";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useChecklistStore } from "@/stores/checklist-store";

/**
 * clear() swaps in fresh ring buffers, so re-read the state before pushing or
 * the sample lands in the orphaned buffer the component never sees.
 */
function seedGpsFix(fixType: number) {
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  s.gps.push({
    timestamp: Date.now(),
    fixType,
    satellites: 14,
    hdop: 0.8,
    lat: 12.9,
    lon: 77.6,
    alt: 900,
  });
}

beforeEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
  useChecklistStore.getState().resetSession();
});

describe("GpsSkyView fix quality labels", () => {
  it("names an RTK fixed solution from the locale file", () => {
    seedGpsFix(6);
    const { container } = renderWithIntl(<GpsSkyView />);
    expect(container.textContent).toContain("RTK Fixed");
  });

  it("names a floating RTK solution distinctly from a fixed one", () => {
    seedGpsFix(5);
    const { container } = renderWithIntl(<GpsSkyView />);
    expect(container.textContent).toContain("RTK Float");
    expect(container.textContent).not.toContain("RTK Fixed");
  });

  it("reports no fix for GPS_FIX_TYPE 1", () => {
    seedGpsFix(1);
    const { container } = renderWithIntl(<GpsSkyView />);
    expect(container.textContent).toContain("No Fix");
    expect(container.textContent).not.toContain("3D Fix");
  });
});

describe("PreFlightChecklist GPS fix reading", () => {
  it("reports an RTK fixed solution on the auto-checked GPS item", () => {
    seedGpsFix(6);
    const { container } = renderWithIntl(<PreFlightChecklist />);
    expect(container.textContent).toContain("RTK Fixed");
  });

  it("reports no fix for GPS_FIX_TYPE 1", () => {
    seedGpsFix(1);
    const { container } = renderWithIntl(<PreFlightChecklist />);
    expect(container.textContent).toContain("No Fix");
    expect(container.textContent).not.toContain("3D Fix");
  });
});

describe("ReplayTelemetryPanel fix reading", () => {
  // This panel used to abbreviate ("RTK Fix" / "RTK Flt"). It now shares the
  // one translated vocabulary; its 192px column holds the long form.
  it("names an RTK fixed solution from the locale file", () => {
    seedGpsFix(6);
    const { container } = renderWithIntl(<ReplayTelemetryPanel />);
    expect(container.textContent).toContain("RTK Fixed");
  });

  it("reports no fix for GPS_FIX_TYPE 1", () => {
    seedGpsFix(1);
    const { container } = renderWithIntl(<ReplayTelemetryPanel />);
    expect(container.textContent).toContain("No Fix");
  });
});
