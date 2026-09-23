/**
 * @license GPL-3.0-only
 *
 * Constant-position mode means the estimator has no external position source,
 * so it must not read as a healthy green dot, and the EKF_STATUS_REPORT flag
 * word must be shown with its fault bits.
 */

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "../../../../locales/en.json";
import { EkfStatusBars } from "@/components/indicators/EkfStatusBars";
import { useTelemetryStore } from "@/stores/telemetry-store";

function renderBars() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EkfStatusBars />
    </NextIntlClientProvider>,
  );
}

function dot(container: HTMLElement, label: string): Element {
  const flag = container.querySelector(`[data-flag="${label}"]`);
  if (!flag?.firstElementChild) throw new Error(`no ${label} flag`);
  return flag.firstElementChild;
}

function pushEkf(flags: number) {
  useTelemetryStore.getState().pushEkf({
    timestamp: Date.now(),
    velocityVariance: 0.1,
    posHorizVariance: 0.1,
    posVertVariance: 0.1,
    compassVariance: 0.1,
    terrainAltVariance: 0.1,
    flags,
  });
}

describe("EkfStatusBars flags", () => {
  beforeEach(() => useTelemetryStore.getState().clear());
  afterEach(cleanup);

  it("shows ESTIMATOR_STATUS constant-position mode as a warning, not a healthy dot", () => {
    pushEkf(0x0001);
    useTelemetryStore.getState().pushEstimatorStatus({
      timestamp: Date.now(),
      velRatio: 0,
      posHorizRatio: 0,
      posVertRatio: 0,
      magRatio: 0,
      haglRatio: 0,
      tasRatio: 0,
      posHorizAccuracy: 0,
      posVertAccuracy: 0,
      flags: 0x0081,
    });
    const { container } = renderBars();
    expect(dot(container, "ESTIMATOR_CONST_POS_MODE").className).toContain("bg-status-warning");
    expect(dot(container, "ESTIMATOR_ATTITUDE").className).toContain("bg-status-success");
  });

  it("renders the EKF_STATUS_REPORT flag word with its fault bits", () => {
    pushEkf(0x0400 | 0x8000 | 0x0080);
    const { container } = renderBars();
    expect(dot(container, "EKF_UNINITIALIZED").className).toContain("bg-status-error");
    expect(dot(container, "EKF_GPS_GLITCHING").className).toContain("bg-status-error");
    expect(dot(container, "EKF_CONST_POS_MODE").className).toContain("bg-status-warning");
  });
});
