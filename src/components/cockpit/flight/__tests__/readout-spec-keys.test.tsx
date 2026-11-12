/**
 * @license GPL-3.0-only
 *
 * The bottom row labels and the follow range panel read their words from the
 * shared cockpit spec table, not from literals or the app's own messages.
 * The spec lookup is replaced by one that echoes the key, so any word that
 * bypasses it shows up.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("@/lib/cockpit/spec-strings", async (orig) => {
  const real = await orig<typeof import("@/lib/cockpit/spec-strings")>();
  return {
    ...real,
    specString: (key: string, values?: Record<string, string | number>) =>
      values && "v" in values ? `<${key}:${values.v}>` : `<${key}>`,
  };
});

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { BottomRow } from "../BottomRow";
import { FollowRangePanel } from "@/components/cockpit/FollowRangePanel";
import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { followState } from "../../__tests__/follow-fixtures";

const DRONE = "node:readout-spec";

afterEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
  useNavStreamStore.setState({ byDrone: {} });
});

describe("cockpit readouts on spec keys", () => {
  it("labels the bottom row with cockpit.readout.*", () => {
    renderWithIntl(<BottomRow droneId={DRONE} />);
    const labels = Array.from(document.querySelectorAll("[data-zone='bottom_row'] .fs-label")).map(
      (el) => el.textContent,
    );
    expect(labels.slice(0, 2)).toEqual(["<cockpit.readout.distance>", "<cockpit.readout.height>"]);
    for (const l of labels) expect(l).toMatch(/^<cockpit\.readout\.(distance|height|hspeed|vspeed|agl)>$/);
  });

  it("titles each bottom row cell with its cockpit.readout.*_title", () => {
    renderWithIntl(<BottomRow droneId={DRONE} />);
    const cells = Array.from(document.querySelectorAll("[data-zone='bottom_row'] .fs-row-cell"));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.getAttribute("title")).toMatch(/^<cockpit\.readout\.(distance|height|hspeed|vspeed|agl)_title>$/);
    }
  });

  it("words the follow range panel from follow.*", () => {
    useNavStreamStore
      .getState()
      .setFollow(DRONE, followState({ aglSource: "baro", phase: "coasting" }));
    renderWithIntl(
      <CockpitLayoutContext.Provider value={{ widthClass: "expanded", width: 1280, height: 720 }}>
        <FollowRangePanel droneId={DRONE} />
      </CockpitLayoutContext.Provider>,
    );
    const panel = screen.getByTestId("follow-range-panel");
    expect(panel.getAttribute("aria-label")).toBe("<follow.range>");
    const text = panel.textContent ?? "";
    for (const key of [
      "follow.phase.coasting",
      "agl.source.baro",
      "cockpit.readout.agl",
      "follow.geo.depression:22°",
      "follow.geo.bearing:064",
      "follow.cue.ground",
      "follow.cue.box_height",
      "follow.cue.lidar",
      "follow.latency:85 ms",
      "follow.mode.smart",
    ]) {
      expect(text).toContain(`<${key}>`);
    }
  });
});
