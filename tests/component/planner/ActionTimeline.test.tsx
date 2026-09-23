/**
 * Attached actions show and upload what the flight controller will do: a
 * positioned action picked from the list starts at a real location and can be
 * moved, and a DO_JUMP the controller never takes (repeat 0) reads inactive and
 * draws no jump on the map.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { CommandMissionAction, Waypoint } from "@/lib/types";
import { WaypointActionTimeline } from "@/components/planner/WaypointActionTimeline";
import { ActionRow } from "@/components/planner/ActionRow";
import { JumpArrowOverlay } from "@/components/planner/JumpArrowOverlay";
import { expandToItems } from "@/lib/mission/mission-expand";
import { cmdMap } from "@/lib/mission-io-formats";
import { validateMission } from "@/lib/validation/mission-validator";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("leaflet", () => ({ default: { divIcon: () => ({}) } }));
vi.mock("react-leaflet", () => ({
  Polyline: () => <div data-testid="jump-arc" />,
  Marker: () => null,
}));

const noop = () => {};
const rowHandlers = {
  onToggleExpand: noop, onRemove: noop, onDragStart: noop, onDragOver: noop,
  onDragEnd: noop, onDrop: noop, dragOver: false,
};

const PARENT: Waypoint = { id: "w1", lat: 12.98, lon: 77.6, alt: 30, command: "WAYPOINT" };

describe("positioned actions", () => {
  it("an ROI picked from the add-action list starts at its waypoint and uploads there", () => {
    const onUpdate = vi.fn();
    renderWithIntl(<WaypointActionTimeline waypoint={PARENT} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Region of Interest/ }));

    const actions = onUpdate.mock.calls[0][0].actions as CommandMissionAction[];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ command: "ROI", lat: PARENT.lat, lon: PARENT.lon });

    const mission: Waypoint[] = [
      { id: "t", lat: 12.97, lon: 77.59, alt: 30, command: "TAKEOFF" },
      { ...PARENT, actions },
      { id: "l", lat: 12.99, lon: 77.61, alt: 0, command: "LAND" },
    ];
    expect(validateMission(mission, { defaultFrame: "relative" }).errors).toEqual([]);
    const roi = expandToItems(mission, { defaultFrame: "relative" }).find((it) => it.command === cmdMap.ROI);
    expect(roi?.x).toBe(Math.round(PARENT.lat * 1e7));
    expect(roi?.y).toBe(Math.round(PARENT.lon * 1e7));
  });

  it("an expanded ROI row edits its latitude, longitude and altitude", () => {
    const onUpdate = vi.fn();
    const roi: CommandMissionAction = { id: "a1", command: "ROI", lat: 12.98, lon: 77.6, alt: 0 };
    renderWithIntl(
      <ActionRow action={roi} targets={[]} expanded onUpdate={onUpdate} {...rowHandlers} />,
    );
    const lat = screen.getByLabelText("Latitude") as HTMLInputElement;
    expect(lat.value).toBe("12.98");
    fireEvent.change(lat, { target: { value: "12.985" } });
    fireEvent.blur(lat);
    const alt = screen.getByLabelText("Altitude");
    fireEvent.change(alt, { target: { value: "15" } });
    fireEvent.blur(alt);
    expect(onUpdate.mock.calls).toEqual([[{ lat: 12.985 }], [{ alt: 15 }]]);
  });
});

describe("DO_JUMP repeat 0", () => {
  const jump = (param2?: number): CommandMissionAction => ({ id: "j", command: "DO_JUMP", jumpTargetId: "w1", param2 });

  it("reads inactive on the action row", () => {
    renderWithIntl(
      <ActionRow action={jump()} targets={[{ id: "w1", label: "WP 1" }]} expanded={false} onUpdate={noop} {...rowHandlers} />,
    );
    expect(screen.getByText(/→ WP 1 ×0 \(inactive\)/)).toBeTruthy();
  });

  it("draws no jump arrow on the map, while a real repeat does", () => {
    const mission = (param2?: number): Waypoint[] => [
      PARENT,
      { id: "w2", lat: 12.99, lon: 77.61, alt: 30, command: "WAYPOINT", actions: [jump(param2)] },
    ];
    const { rerender } = renderWithIntl(<JumpArrowOverlay waypoints={mission()} />);
    expect(screen.queryAllByTestId("jump-arc")).toHaveLength(0);
    rerender(<JumpArrowOverlay waypoints={mission(2)} />);
    expect(screen.queryAllByTestId("jump-arc")).toHaveLength(1);
  });
});
