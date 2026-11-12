/**
 * @module shared/compute-metrics-wait.test
 * @description The Compute card's capability wait resolves: after the wait it
 * says the capabilities were not reported instead of waiting forever.
 * @license GPL-3.0-only
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { CAPABILITIES_WAIT_MS, ComputeMetricsCard } from "../ComputeMetricsCard";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ComputeMetricsCard capability wait", () => {
  it("times the wait out to 'not reported'", () => {
    vi.useFakeTimers();
    useAgentCapabilitiesStore.setState({ loaded: false });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ComputeMetricsCard />
      </NextIntlClientProvider>,
    );
    const m = messages.computeMetrics;
    expect(screen.getByText(m.waitingForCapabilities)).toBeTruthy();
    act(() => vi.advanceTimersByTime(CAPABILITIES_WAIT_MS + 1));
    expect(screen.getByText(m.capabilitiesNotReported)).toBeTruthy();
    expect(screen.queryByText(m.waitingForCapabilities)).toBeNull();
  });
});
