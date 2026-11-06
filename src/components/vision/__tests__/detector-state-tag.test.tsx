/**
 * @license GPL-3.0-only
 *
 * The detector state tag explains an empty overlay (detector idle, camera
 * refused, pairing key refused, no direct link, agent unreachable) and stays
 * out of the way while the camera is detecting or a fresh batch is on screen.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import type { DetectionDemandStatus } from "@/lib/agent/detection-demand";
import { DetectorStateTag } from "../DetectorStateTag";

function tag(status: DetectionDemandStatus | null, show = true) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DetectorStateTag status={status} show={show} />
    </NextIntlClientProvider>,
  );
  return container.querySelector('[data-testid="detector-state"]');
}

describe("DetectorStateTag", () => {
  it.each([
    ["idle", messages.hud.detector.idle],
    ["rejected", messages.hud.detector.rejected],
    ["unauthorized", messages.hud.detector.unauthorized],
    ["no-link", messages.hud.detector.noLink],
    ["error", messages.hud.detector.unreachable],
  ] as const)("names the %s state", (status, text) => {
    expect(tag(status)?.textContent).toBe(text);
  });

  it("says nothing while detecting, pending, unsupported or not holding", () => {
    for (const status of ["detecting", "pending", "unsupported", null] as const) {
      expect(tag(status)).toBeNull();
    }
  });

  it("says nothing while a fresh batch is shown", () => {
    expect(tag("idle", false)).toBeNull();
  });
});
