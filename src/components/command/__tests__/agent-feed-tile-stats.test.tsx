/**
 * @module command/agent-feed-tile-stats.test
 * @description Fleet grid tiles: the flight-controller heartbeat shows the
 * link age instead of a permanent "--", the ground station draws no sourceless
 * uplink/mesh tiles, and the stat grid picks its columns from the tile width.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";

vi.mock("@/hooks/use-agent-video-session", () => ({
  useAgentVideoSession: () => ({ state: "idle" }),
}));
vi.mock("@/hooks/use-whep-key", () => ({ usePairedWhepKey: () => null }));
vi.mock("../AgentFeedTileActions", () => ({ TileActions: () => null }));
vi.mock("../AgentFeedTileBadges", () => ({ TileBadges: () => null }));

import { AgentFeedTile } from "../AgentFeedTile";

function agent(profile: string, over: Record<string, unknown> = {}) {
  return {
    identity: { deviceId: "d1", name: "Bravo-02" },
    profile,
    liveness: "live",
    lastSeen: Date.now() - 12_000,
    telemetry: { armed: true, mode: "AUTO", gpsSatellites: 15, batteryRemaining: 80, altitudeRel: 10 },
    system: { cpuPercent: null, memoryPercent: null, temperature: null, diskPercent: null, fcReachable: true },
    video: { state: "unavailable", whepUrl: null, active: false },
    radio: null,
    ...over,
  } as never;
}

function renderTile(a: never) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentFeedTile
        agent={a}
        pinned={false}
        paused={false}
        onOpen={() => {}}
        onTogglePin={() => {}}
        onTogglePause={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

const cf = messages.commandFleet;
afterEach(cleanup);

describe("AgentFeedTile stats", () => {
  it("shows the flight controller's heartbeat age", () => {
    renderTile(agent("drone"));
    const label = screen.getByText(cf.heartbeat);
    const tile = label.closest("div")?.parentElement as HTMLElement;
    expect(tile.textContent).toContain("12s");
  });

  it("draws no sourceless uplink or mesh tile on a ground station", () => {
    renderTile(
      agent("ground_station", {
        system: { cpuPercent: 10, memoryPercent: 20, temperature: 40, diskPercent: 5, fcReachable: false },
      }),
    );
    expect(screen.queryByText(cf.uplink)).toBeNull();
    expect(screen.queryByText(cf.mesh)).toBeNull();
  });

  it("picks the column count from the tile width", () => {
    renderTile(agent("drone"));
    const grid = screen.getByTestId("agent-feed-stats");
    expect(grid.className).toContain("@[420px]:grid-cols-4");
    expect(grid.className).not.toContain("sm:grid-cols-4");
    expect(grid.parentElement?.className).toContain("@container");
  });
});
