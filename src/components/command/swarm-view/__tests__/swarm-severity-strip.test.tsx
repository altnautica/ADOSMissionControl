/**
 * The severity filter must always be releasable: when the condition behind
 * the active chip clears and its count drops to 0, the chip stays clickable
 * and a "Show all" control restores the whole board.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("../use-swarm-slot-rows", () => ({
  // An all-nominal fleet: every exception chip counts 0.
  useSwarmSlotRows: () => [],
}));

import { SwarmSeverityStrip } from "../SwarmSeverityStrip";

afterEach(cleanup);

describe("SwarmSeverityStrip filter release", () => {
  it("keeps the active chip clickable at a zero count and offers Show all", () => {
    const onToggle = vi.fn();
    renderWithIntl(
      <SwarmSeverityStrip rows={[]} nodesBySlot={new Map()} active="error" onToggle={onToggle} />,
    );

    const activeChip = screen.getByRole("button", { pressed: true });
    expect((activeChip as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(activeChip);
    expect(onToggle).toHaveBeenLastCalledWith("error");

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onToggle).toHaveBeenLastCalledWith("error");
  });

  it("leaves an inactive empty chip inert and shows no Show all", () => {
    renderWithIntl(
      <SwarmSeverityStrip rows={[]} nodesBySlot={new Map()} active={null} onToggle={vi.fn()} />,
    );
    for (const chip of screen.getAllByRole("button", { pressed: false })) {
      expect((chip as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });
});
