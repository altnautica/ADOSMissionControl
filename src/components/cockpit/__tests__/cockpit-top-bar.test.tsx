import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

/** The safety band reads live telemetry + arm state from real stores; their
 * defaults (no telemetry at all) are enough — the band renders its stat
 * scaffold regardless of data, which is exactly the "always-on" contract.
 *
 * With no heartbeat the arm pill and mode MUST read the no-data glyph, not the
 * store defaults: a band that renders "DISARMED" / "STABILIZE" for a vehicle it
 * has never heard from is asserting a confirmed-safe state it never measured. */
function renderBand(props: { lean?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitTopBar {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CockpitTopBar (always-on safety band)", () => {
  afterEach(cleanup);

  it("always renders the safety stats (arm pill + battery/GPS/link)", () => {
    const { container } = renderBand();
    expect(container.querySelector(".safety")).not.toBeNull();
    // Arm pill — no heartbeat, so it must NOT claim "DISARMED".
    expect(screen.queryByText(messages.cockpit.disarmed.toUpperCase())).toBeNull();
    expect(screen.getAllByText(NO_DATA_GLYPH).length).toBeGreaterThan(0);
    // Battery / GPS / link stat labels are present.
    expect(screen.getByText(messages.cockpit.band.batt)).toBeTruthy();
    expect(screen.getByText(messages.cockpit.strip.gps)).toBeTruthy();
    expect(screen.getByText(messages.cockpit.strip.link)).toBeTruthy();
  });

  it("shows the decorative wordmark in the full band", () => {
    renderBand({ lean: false });
    expect(screen.getByText("ADOS")).toBeTruthy();
  });

  it("drops the wordmark in lean mode but keeps the safety stats", () => {
    const { container } = renderBand({ lean: true });
    expect(screen.queryByText("ADOS")).toBeNull();
    // Safety pill + stats stay — lean only removes the decorative label.
    expect(container.querySelector(".safety")).not.toBeNull();
    expect(screen.getAllByText(NO_DATA_GLYPH).length).toBeGreaterThan(0);
    expect(screen.getByText(messages.cockpit.strip.gps)).toBeTruthy();
  });
});
