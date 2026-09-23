/**
 * @license GPL-3.0-only
 *
 * The telemetry deck must not present a dead link as a live one, and must not
 * judge a whole pack against per-cell thresholds.
 *
 * - Every ring buffer keeps its last sample forever. An ungated deck kept
 *   ROLL, BAT V and RSSI in "normal" styling after the telemetry radio died,
 *   and showed wings-level zeros before the first ATTITUDE arrived.
 * - When the FC does not monitor cells, BATTERY_STATUS carries the whole pack
 *   voltage in voltages[0]. Counting that as one cell applied 3.5 V per-cell
 *   thresholds to a 16 V pack, so a sagging pack never alarmed.
 */

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "../../../../../locales/en.json";
import { useTelemetryDeck } from "../TelemetryDeck";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useSettingsStore } from "@/stores/settings-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function DeckHarness() {
  const { panel } = useTelemetryDeck();
  return <>{panel}</>;
}

function renderDeck() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeckHarness />
    </NextIntlClientProvider>,
  );
}

/** The value text and severity border of the cell labelled `label`. */
function cell(container: HTMLElement, label: string) {
  const span = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === label);
  const root = span?.parentElement?.parentElement;
  return {
    value: root?.lastElementChild?.textContent ?? null,
    critical: root?.className.includes("border-status-error") ?? false,
  };
}

function pushAttitude(ageMs: number) {
  useTelemetryStore.getState().pushAttitude({
    timestamp: Date.now() - ageMs,
    roll: 2.1,
    pitch: -1.4,
    yaw: 45,
    rollSpeed: 0,
    pitchSpeed: 0,
    yawSpeed: 0,
  });
}

function pushBattery(voltage: number, extra: { cellVoltages?: number[]; cellCount?: number }, ageMs = 0) {
  useTelemetryStore.getState().pushBattery({
    timestamp: Date.now() - ageMs,
    voltage,
    current: 12,
    remaining: 50,
    consumed: 900,
    ...extra,
  });
}

describe("telemetry deck freshness", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    const page = useSettingsStore.getState().telemetryDeckActivePage;
    useSettingsStore.getState().setTelemetryDeckPageMetrics(page, ["roll", "pitch", "batteryVoltage"]);
  });
  afterEach(cleanup);

  it("shows no attitude before the first ATTITUDE, not wings level", () => {
    const { container } = renderDeck();
    expect(cell(container, "ROLL").value).toBe("--");
    expect(cell(container, "PITCH").value).toBe("--");
    expect(cell(container, "BAT V").value).toBe("--");
  });

  it("shows live values from fresh samples", () => {
    pushAttitude(0);
    const { container } = renderDeck();
    expect(cell(container, "ROLL").value).toBe("2.1°");
    expect(container.querySelector("[data-testid='deck-link-silent']")).toBeNull();
  });

  it("blanks the values and says the link is silent once they go stale", () => {
    pushAttitude(TELEMETRY_STALE_MS + 1_000);
    pushBattery(15.9, {}, TELEMETRY_STALE_MS + 1_000);
    const { container } = renderDeck();
    expect(cell(container, "ROLL").value).toBe("--");
    expect(cell(container, "BAT V").value).toBe("--");
    expect(container.querySelector("[data-testid='deck-link-silent']")).not.toBeNull();
  });
});

describe("telemetry deck battery cell thresholds", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    const page = useSettingsStore.getState().telemetryDeckActivePage;
    useSettingsStore.getState().setTelemetryDeckPageMetrics(page, ["batteryVoltage"]);
  });
  afterEach(cleanup);

  it("does not read a whole-pack voltage in voltages[0] as one cell", () => {
    // 4S at 13.0 V (3.25 V/cell) with no cell monitoring; the FC reports the
    // pack as 4S.
    pushBattery(13.0, { cellVoltages: [13.0], cellCount: 4 });
    const { container } = renderDeck();
    expect(cell(container, "BAT V").critical).toBe(true);
  });

  it("does not infer the cell count from a sagging pack voltage", () => {
    // 4S at 14.0 V: 14.0 / 4.2 rounds to 3, which would read a healthy 3S.
    pushBattery(14.0, { cellCount: 4 });
    const { container } = renderDeck();
    expect(cell(container, "BAT V").critical).toBe(true);
  });

  it("gives no verdict while the cell count is unknown", () => {
    pushBattery(14.0, { cellVoltages: [14.0] });
    const { container } = renderDeck();
    expect(cell(container, "BAT V").value).toBe("14.0V");
    expect(cell(container, "BAT V").critical).toBe(false);
  });
});
