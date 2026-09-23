/**
 * Weather card: the go / no-go badge only stands on a recent observation, the
 * observation age is shown, and the card refetches on a fixed cadence.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act } from "@testing-library/react";
import type { WeatherReport } from "@/lib/weather/open-meteo";

const fetchWeather = vi.fn<(lat: number, lon: number, signal?: AbortSignal) => Promise<WeatherReport | null>>();
vi.mock("@/lib/weather/open-meteo", () => ({
  fetchWeather: (lat: number, lon: number, signal?: AbortSignal) => fetchWeather(lat, lon, signal),
}));

import { WeatherCard } from "@/components/planner/WeatherCard";
import { useClockStore } from "@/stores/clock-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

function calm(observedAt: number): WeatherReport {
  return {
    observedAt, windSpeedMps: 2, windGustMps: 3, windDirectionDeg: 90, temperatureC: 20,
    levels: [], forecastPeakGustMps: null, forecastWindowHours: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
  useClockStore.setState({ now: Date.now() });
  fetchWeather.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("WeatherCard", () => {
  it("grades a recent observation and shows its age", async () => {
    fetchWeather.mockResolvedValue(calm(Date.now() - 10 * 60_000));
    renderWithIntl(<WeatherCard lat={12.97} lon={77.59} />);
    await settle(600);
    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText(/10 min ago/)).toBeInTheDocument();
  });

  it("drops the go badge for an observation past the staleness window", async () => {
    fetchWeather.mockResolvedValue(calm(Date.now() - 3 * 60 * 60_000));
    renderWithIntl(<WeatherCard lat={12.97} lon={77.59} />);
    await settle(600);
    expect(screen.queryByText("Go")).toBeNull();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("refetches while shown", async () => {
    fetchWeather.mockResolvedValue(calm(Date.now()));
    renderWithIntl(<WeatherCard lat={12.97} lon={77.59} />);
    await settle(600);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await settle(5 * 60_000);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });
});
