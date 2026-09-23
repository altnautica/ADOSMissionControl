/**
 * The connection meter over a live RADIO_STATUS: RADIO_STATUS carries no
 * timing, so no latency figure is derived from the TX buffer.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup } from "@testing-library/react";

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { ConnectionQualityMeter } from "@/components/indicators/ConnectionQualityMeter";
import { useTelemetryStore } from "@/stores/telemetry-store";

afterEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
});

describe("ConnectionQualityMeter (live radio)", () => {
  it("shows no latency derived from a half-full TX buffer", () => {
    act(() => {
      useTelemetryStore.getState().pushRadio({
        timestamp: Date.now(),
        rssi: 200,
        remrssi: 190,
        txbuf: 50,
        noise: 40,
        remnoise: 45,
        rxerrors: 0,
        fixed: 0,
        sourceSystemId: 51,
      });
    });
    const { container } = renderWithIntl(<ConnectionQualityMeter />);
    const root = container.firstChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d+ms/);
    expect(root.getAttribute("title")).toContain("TX buffer free: 50%");
  });
});
