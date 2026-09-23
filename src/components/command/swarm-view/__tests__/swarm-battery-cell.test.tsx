/**
 * The swarm board's battery column reads the node's status, not the beacon, so
 * it is gated on that status's own reading: a silent slot or a node whose FC
 * link died shows no battery, and a stale status is dimmed, whatever the
 * beacon's freshness says.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import { BatteryCell } from "../swarm-cells";
import type { SwarmSlotRow } from "../swarm-rows";

afterEach(cleanup);

function slotRow(
  summary: Partial<CommandAgentSummary> & { fcReachable?: boolean },
): SwarmSlotRow {
  const { fcReachable = true, ...rest } = summary;
  return {
    slot: 7,
    // No beacon: the slot went silent on the swarm bus.
    beacon: null,
    node: null,
    severity: "noBeacon",
    summary: {
      liveness: "live",
      profile: "drone",
      system: { fcReachable },
      telemetry: { batteryRemaining: 64 },
      ...rest,
    } as CommandAgentSummary,
  };
}

describe("swarm BatteryCell", () => {
  it("shows nothing for a node whose status went offline", () => {
    renderWithIntl(<BatteryCell row={slotRow({ liveness: "offline" })} />);
    expect(screen.queryByText("64%")).toBeNull();
    expect(screen.getByText(/No live reading/)).toBeTruthy();
  });

  it("shows nothing for a beaconing node whose FC link died", () => {
    renderWithIntl(<BatteryCell row={slotRow({ fcReachable: false })} />);
    expect(screen.queryByText("64%")).toBeNull();
    expect(screen.getByText(/Flight controller not reachable/)).toBeTruthy();
  });

  it("dims a stale status reading", () => {
    renderWithIntl(<BatteryCell row={slotRow({ liveness: "stale" })} />);
    expect(screen.getByText("64%").className).toContain("opacity-60");
  });

  it("shows a live status reading plainly", () => {
    renderWithIntl(<BatteryCell row={slotRow({})} />);
    expect(screen.getByText("64%").className).not.toContain("opacity-60");
  });
});
