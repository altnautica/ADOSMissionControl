/**
 * A fleet-wide action needs BROADCAST armed at the moment it is chosen, not
 * only when its menu was opened: an arm window that lapses while the menu is
 * open must leave no item that opens the confirm.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import type { SwarmSlotRow } from "../swarm-rows";
import { BROADCAST_ARM_MS } from "../use-broadcast-arm";

const node = { deviceId: "ados-1", name: "One" } as FleetNodeEntry;
const summary = { identity: { deviceId: "ados-1" } } as CommandAgentSummary;
const slotRow: SwarmSlotRow = {
  slot: 1,
  beacon: null,
  node,
  registeredDeviceId: "ados-1",
  summary,
  severity: "noBeacon",
};

vi.mock("../use-swarm-bulk-targets", () => ({
  useSwarmBulkTargets: () => ({
    slotRows: [slotRow],
    selectedRows: [slotRow],
    nodeRows: [{ node, summary }],
    configTargets: ["ados-1"],
    nameByDeviceId: new Map([["ados-1", "One"]]),
    // The whole board is selected: this is a broadcast.
    isBroadcast: true,
    configWrite: { pending: false, reachable: new Set(["ados-1"]), writeValue: vi.fn() },
  }),
}));

vi.mock("@/lib/skills", () => {
  const skills = new Map(
    ["pause", "rth", "land"].map((id) => [id, { id, label: id }]),
  );
  return {
    useSkillRegistry: (select: (s: { skills: typeof skills }) => unknown) => select({ skills }),
  };
});

vi.mock("@/lib/skills/skill-label", () => ({
  skillDisplayLabel: (skill: { id: string }) => `skill-${skill.id}`,
}));

vi.mock("@/components/command/nodes-view/use-node-skills", () => ({
  resolveFleetSkillTargets: () => [{ node, summary }],
  dispatchSkillForNodes: vi.fn(),
}));

const confirmOpened = vi.fn();
vi.mock("../SwarmActionConfirm", () => ({
  SwarmSkillConfirm: () => {
    confirmOpened();
    return null;
  },
  SwarmFormationConfirm: () => {
    confirmOpened();
    return null;
  },
}));

import { SwarmActionBar } from "../SwarmActionBar";

beforeEach(() => {
  vi.useFakeTimers();
  confirmOpened.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBar() {
  renderWithIntl(
    <SwarmActionBar
      rows={[]}
      nodesBySlot={new Map([[1, node]])}
      selectedSlots={new Set([1])}
      laneOptions={{} as never}
      onClear={vi.fn()}
    />,
  );
}

describe("SwarmActionBar broadcast gate", () => {
  it("offers a runnable item while armed", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /^Broadcast$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Flight action" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /skill-rth/ }));
    expect(confirmOpened).toHaveBeenCalled();
  });

  it("disables every open-menu item once the arm window lapses", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /^Broadcast$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Flight action" }));
    act(() => {
      vi.advanceTimersByTime(BROADCAST_ARM_MS + 1);
    });

    const item = screen.getByRole("menuitem", { name: /skill-rth/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(confirmOpened).not.toHaveBeenCalled();
  });
});
