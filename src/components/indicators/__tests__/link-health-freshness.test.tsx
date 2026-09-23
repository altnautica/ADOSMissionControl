/**
 * @license GPL-3.0-only
 *
 * The link-quality meter must decay with the link. It reads a ring buffer that
 * keeps its last sample forever, so a SiK link that dropped at four green bars
 * kept showing "excellent" for as long as the page stayed open.
 */

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "../../../../locales/en.json";
import { ConnectionQualityMeter } from "@/components/indicators/ConnectionQualityMeter";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function renderMeter() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConnectionQualityMeter />
    </NextIntlClientProvider>,
  );
}

function pushRadio(ageMs: number) {
  useTelemetryStore.getState().pushRadio({
    timestamp: Date.now() - ageMs,
    rssi: 200,
    remrssi: 190,
    txbuf: 100,
    noise: 40,
    remnoise: 40,
    rxerrors: 0,
    fixed: 0,
    sourceSystemId: 51,
  });
}

beforeEach(() => useTelemetryStore.getState().clear());
afterEach(cleanup);

describe("ConnectionQualityMeter freshness", () => {
  it("renders nothing before any radio report", () => {
    expect(renderMeter().container.textContent).toBe("");
  });

  it("shows live signal bars from a fresh report", () => {
    pushRadio(0);
    const { container } = renderMeter();
    expect(container.querySelector("[data-testid='connection-quality-stale']")).toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(4);
  });

  it("shows an explicit stale state, not the last bars, once the radio goes quiet", () => {
    pushRadio(TELEMETRY_STALE_MS + 1_000);
    const { container } = renderMeter();
    expect(container.querySelector("[data-testid='connection-quality-stale']")).not.toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(0);
  });
});
