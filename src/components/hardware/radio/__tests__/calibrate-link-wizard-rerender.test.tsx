/**
 * @license GPL-3.0-only
 *
 * A calibration run survives parent re-renders. The radio panel re-renders on
 * every poll tick with fresh `sweep` and `lastGood` identities; none of those
 * renders may abort the run or push the last-good trio back to the radio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { CalibrateLinkWizard } from "../CalibrateLinkWizard";
import type { CalMeasurement, CalTrio } from "@/lib/api/ground-station/calibration";

const measure = (): CalMeasurement => ({
  sampledAtMs: null,
  lossPercent: null,
  fecFailed: null,
  validRxPacketsPerS: null,
  bitrateKbps: null,
  rssiDbm: null,
});

function wizard(sweep: (trio: CalTrio) => Promise<void>, lastGood: CalTrio) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <CalibrateLinkWizard
        open
        onClose={() => {}}
        sweep={sweep}
        measure={measure}
        lastGood={lastGood}
        receiverName="ground-1"
      />
    </NextIntlClientProvider>
  );
}

const isLastGood = (trio: CalTrio) => trio.mcs === 9 && trio.fecK === 7 && trio.fecN === 13;

describe("CalibrateLinkWizard · parent re-renders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not revert or abort a running sweep when the parent re-renders", async () => {
    const firstSweep = vi.fn(async (_trio: CalTrio) => {});
    const { rerender } = render(wizard(firstSweep, { mcs: 9, fecK: 7, fecN: 13 }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start sweep" }));
    });
    expect(firstSweep).toHaveBeenCalledTimes(1);
    expect(isLastGood(firstSweep.mock.calls[0][0])).toBe(false);

    // A poll tick: new callback identity, new (equal) last-good object.
    const nextSweep = vi.fn(async (_trio: CalTrio) => {});
    await act(async () => {
      rerender(wizard(nextSweep, { mcs: 9, fecK: 7, fecN: 13 }));
    });

    const restored = [...firstSweep.mock.calls, ...nextSweep.mock.calls].some(([trio]) =>
      isLastGood(trio),
    );
    expect(restored).toBe(false);
    // Still running: the cancel control is shown, not Start.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("restores the trio captured at Start when the dialog unmounts mid-run", async () => {
    const sweep = vi.fn(async (_trio: CalTrio) => {});
    const { rerender, unmount } = render(wizard(sweep, { mcs: 9, fecK: 7, fecN: 13 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start sweep" }));
    });
    // A later render reports a different running trio; the run keeps the one
    // it captured when it started.
    rerender(wizard(sweep, { mcs: 1, fecK: 8, fecN: 16 }));
    unmount();
    expect(sweep.mock.calls.some(([trio]) => isLastGood(trio))).toBe(true);
  });
});
