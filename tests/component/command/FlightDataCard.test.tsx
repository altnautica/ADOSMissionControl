import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FlightDataCard } from "@/components/command/shared/FlightDataCard";
import { useTelemetryStore } from "@/stores/telemetry-store";
import messages from "../../../locales/en.json";

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FlightDataCard />
    </NextIntlClientProvider>,
  );
}

/**
 * A fresh timestamp keeps the GPS channel live, so the card renders the fix
 * label rather than blanking it to the freshness placeholder.
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
});

describe("FlightDataCard", () => {
  it("renders with empty stores without an infinite render loop", () => {
    // Regression guard (carried over when the FC-link summary was merged in):
    // the prearm-buffer selector must return a STABLE reference (select the
    // buffers map + derive the lines outside the selector via a shared empty
    // constant). A selector that returns a fresh `[]` each render makes
    // useSyncExternalStore fail to cache the snapshot and React throws
    // "Maximum update depth exceeded".
    expect(() =>
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <FlightDataCard />
        </NextIntlClientProvider>,
      ),
    ).not.toThrow();
  });
});

describe("FlightDataCard GPS fix quality label", () => {
  // The fix label used to come from a private English table in this file, so
  // a non-English operator read English for the one reading that separates a
  // centimetre-accurate RTK solution from a metre-accurate 3D fix.
  it("names an RTK fixed solution from the locale file", () => {
    seedGpsFix(6);
    const { container } = renderCard();
    expect(container.textContent).toContain("RTK Fixed");
  });

  it("reports no fix for GPS_FIX_TYPE 1", () => {
    seedGpsFix(1);
    const { container } = renderCard();
    expect(container.textContent).toContain("No Fix");
    expect(container.textContent).not.toContain("3D Fix");
  });
});
