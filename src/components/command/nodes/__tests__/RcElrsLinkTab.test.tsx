/**
 * @license GPL-3.0-only
 *
 * The RC / ExpressLRS control-lane tab surfaces the CRSF snapshot honestly on
 * every reach path. These tests focus on the two fields the wire contract just
 * corrected: the real TX power in milliwatts (now carried on the cloud
 * heartbeat, not just the LAN sidecar) and the MAVLink-over-ELRS command-down
 * safety gate. The snapshots are built by running normalizeCrsf over a
 * camelCase heartbeat block, so the test exercises the actual cloud path
 * (heartbeat block → normalizer → tab), not a hand-built CrsfState.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import { normalizeCrsf } from "@/stores/agent-capabilities/normalizer";
import messages from "../../../../../locales/en.json";

afterEach(cleanup);

function renderTab(heartbeatCrsf: Record<string, unknown> | null) {
  const crsf = heartbeatCrsf === null ? null : normalizeCrsf(heartbeatCrsf);
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RcElrsLinkTab crsf={crsf} />
    </NextIntlClientProvider>,
  );
}

describe("RcElrsLinkTab TX power on a cloud-reached node", () => {
  it("shows the real TX power in mW carried on the cloud heartbeat", () => {
    // A cloud-reached node's heartbeat now carries txPowerMw (renamed from the
    // old always-null txPowerDbm projection), so the lane surfaces real power.
    renderTab({ state: "link_ok", txPowerMw: 250, mode: "crsf_rc" });
    expect(screen.getByText("250 mW")).toBeTruthy();
  });

  it("shows … (not a fabricated 0 mW) when no TX power is reported", () => {
    renderTab({ state: "ready" });
    // The TX-power row still renders; its value is the empty placeholder, never
    // a fabricated 0 mW.
    expect(screen.queryByText("0 mW")).toBeNull();
    expect(screen.getByText(messages.rcElrsLink.stats.txPower)).toBeTruthy();
  });
});

describe("RcElrsLinkTab command-down safety gate", () => {
  it("shows the gated-command warning when the MAVLink-over-ELRS gate is closed", () => {
    renderTab({
      state: "link_ok",
      mode: "mavlink",
      txPowerMw: 100,
      fcCommandDownGated: true,
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      messages.rcElrsLink.commandDownGated.title,
    );
  });

  it("hides the gated-command warning when the command path is open", () => {
    renderTab({
      state: "link_ok",
      mode: "mavlink",
      txPowerMw: 100,
      fcCommandDownGated: false,
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByText(messages.rcElrsLink.commandDownGated.title),
    ).toBeNull();
  });

  it("hides the gated-command warning when there is no verdict (absent gate)", () => {
    // A CRSF RC-channel lane has no MAVLink command-down concept, so the gate is
    // absent → no verdict → the warning must not imply commands are blocked.
    renderTab({ state: "link_ok", mode: "crsf_rc", txPowerMw: 100 });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("RcElrsLinkTab empty state", () => {
  it("renders an explicit empty state when no lane is advertised", () => {
    renderTab(null);
    expect(screen.getByText(messages.rcElrsLink.empty.title)).toBeTruthy();
  });
});
