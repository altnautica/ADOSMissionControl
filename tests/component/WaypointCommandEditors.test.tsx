/**
 * Component tests for the per-command parameter editors: each field must
 * commit to the model slot that expands into the right MAVLink parameter.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import {
  CommandSpecificEditors,
  INavCommandEditors,
} from "@/components/planner/WaypointCommandEditors";
import { renderWithIntl } from "../helpers/intl-wrapper";

// Mock lucide-react icons used transitively
vi.mock("lucide-react", () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="icon-chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="icon-chevron-right" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="icon-check" {...props} />,
  Search: (props: Record<string, unknown>) => <span data-testid="icon-search" {...props} />,
  GripVertical: (props: Record<string, unknown>) => <span {...props} />,
  X: (props: Record<string, unknown>) => <span {...props} />,
}));

const noop = () => {};

function cmdProps(cmd: string, commitField: (field: string, value: string) => void) {
  return {
    cmd,
    params: {},
    localParam1: "11",
    localParam2: "22",
    localParam3: "33",
    localHoldTime: "44",
    setLocalParam1: noop,
    setLocalParam2: noop,
    setLocalParam3: noop,
    setLocalHoldTime: noop,
    commitField,
    onUpdate: noop,
  };
}

describe("CommandSpecificEditors slot routing", () => {
  it("LOITER_TURNS turns commit to holdTime (MAVLink param1) and radius to param2 (MAVLink param3)", () => {
    const commit = vi.fn();
    renderWithIntl(<CommandSpecificEditors {...cmdProps("LOITER_TURNS", commit)} />);
    fireEvent.blur(screen.getByLabelText(/Turns/i));
    fireEvent.blur(screen.getByLabelText(/Radius/i));
    expect(commit.mock.calls).toEqual([["holdTime", "44"], ["param2", "22"]]);
  });

  it("PAYLOAD_PLACE max descent commits to holdTime (MAVLink param1)", () => {
    const commit = vi.fn();
    renderWithIntl(<CommandSpecificEditors {...cmdProps("NAV_PAYLOAD_PLACE", commit)} />);
    fireEvent.blur(screen.getByLabelText(/Max Descent/i));
    expect(commit.mock.calls).toEqual([["holdTime", "44"]]);
  });
});

describe("CommandSpecificEditors truthful fields", () => {
  it("offers a hold time where the flight controller waits, never on an unlimited loiter", () => {
    for (const cmd of ["WAYPOINT", "LOITER_TIME", "SPLINE_WAYPOINT"]) {
      const { unmount } = renderWithIntl(<CommandSpecificEditors {...cmdProps(cmd, noop)} />);
      expect(screen.queryByLabelText(/Hold Time/i)).not.toBeNull();
      unmount();
    }
    renderWithIntl(<CommandSpecificEditors {...cmdProps("LOITER", noop)} />);
    expect(screen.queryByLabelText(/Hold Time/i)).toBeNull();
  });

  it("shows a fence action with no param1 (a downloaded fence-disable) as Disable", () => {
    renderWithIntl(<CommandSpecificEditors {...cmdProps("DO_FENCE_ENABLE", noop)} />);
    expect(screen.getByRole("combobox", { name: /Fence/i }).textContent).toBe("Disable");
  });
});

describe("INavCommandEditors slot routing", () => {
  it("LAND site elevation commits to param1, which expands to MAVLink param2 (iNav p2)", () => {
    const commit = vi.fn();
    renderWithIntl(
      <INavCommandEditors cmd="LAND" localParam1="12" localHoldTime="" setLocalParam1={noop}
        setLocalHoldTime={noop} commitField={commit} />,
    );
    fireEvent.blur(screen.getByLabelText(/Elevation/i));
    expect(commit.mock.calls).toEqual([["param1", "12"]]);
  });

  it("POSHOLD_TIME hold time commits to holdTime (MAVLink param1, iNav p1)", () => {
    const commit = vi.fn();
    renderWithIntl(
      <INavCommandEditors cmd="LOITER_TIME" localParam1="" localHoldTime="30" setLocalParam1={noop}
        setLocalHoldTime={noop} commitField={commit} />,
    );
    fireEvent.blur(screen.getByLabelText(/Hold time/i));
    expect(commit.mock.calls).toEqual([["holdTime", "30"]]);
  });
});
