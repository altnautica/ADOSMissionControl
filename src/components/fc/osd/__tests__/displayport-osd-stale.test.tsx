/**
 * @module fc/osd/displayport-osd-stale.test
 * @description The OSD preview only says "live" while frames keep arriving;
 * the last grid of a stopped stream is labelled stale.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DisplayPortOsdPanel } from "../DisplayPortOsdPanel";
import { useDisplayPortStore } from "@/stores/displayport-store";
import { useClockStore } from "@/stores/clock-store";

const droneState = { drones: new Map(), selectedDroneId: null };
vi.mock("@/stores/drone-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));

const NOW = 1_700_000_000_000;

beforeEach(() => {
  useClockStore.setState({ now: NOW });
});

describe("DisplayPortOsdPanel status", () => {
  it("is live while the last frame is recent", () => {
    useDisplayPortStore.setState({ lastFrameAt: NOW - 500, lines: ["ALT 12"] });
    render(<DisplayPortOsdPanel />);
    expect(screen.getByText("live")).toBeTruthy();
  });

  it("turns stale once frames stop arriving", () => {
    useDisplayPortStore.setState({ lastFrameAt: NOW - 30_000, lines: ["ALT 12"] });
    render(<DisplayPortOsdPanel />);
    expect(screen.queryByText("live")).toBeNull();
    expect(screen.getByText("stale")).toBeTruthy();
  });
});
