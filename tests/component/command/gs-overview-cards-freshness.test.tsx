/**
 * Ground-station overview cards render a slice only as a reading of the node:
 * an initial default that was never read says "not read", and a snapshot that
 * stopped refreshing is marked stale, rather than "Unpaired", "Unset",
 * "Mesh not enabled" or "Down" stated as the node's current state.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const poll = vi.hoisted(() => ({
  run: null as null | ((api: unknown) => Promise<void>),
}));
vi.mock("@/components/command/nodes/ground-station/use-gs-poll", () => ({
  useGroundStationPoll: (
    _url: unknown,
    _key: unknown,
    _ms: unknown,
    run: (api: unknown) => Promise<void>,
  ) => {
    poll.run = run;
  },
}));
vi.mock("@/components/command/AgentDisconnectedPage", () => ({
  AgentDisconnectedPage: () => null,
}));

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { PairedDroneCard } from "@/components/command/shared/PairedDroneCard";
import { GroundStationMeshCard } from "@/components/command/shared/GroundStationMeshCard";
import { GroundStationUplinkCard } from "@/components/command/shared/GroundStationUplinkCard";
import { GroundStationOverview } from "@/components/command/overview/GroundStationOverview";

const initial = useGroundStationStore.getState();

beforeEach(() => {
  useGroundStationStore.setState(initial, true);
});
afterEach(() => {
  cleanup();
  useGroundStationStore.setState(initial, true);
});

function renderCards() {
  renderWithIntl(
    <>
      <PairedDroneCard />
      <GroundStationMeshCard />
      <GroundStationUplinkCard />
    </>,
  );
}

describe("ground-station overview cards", () => {
  it("never states initial defaults as the node's state", () => {
    renderCards();
    expect(screen.queryByText("No drone paired")).toBeNull();
    expect(screen.queryByText("Unset")).toBeNull();
    expect(screen.queryByText("Mesh not enabled on this node.")).toBeNull();
    expect(screen.queryByText("Down")).toBeNull();
    expect(screen.getByText("Not read from this node")).toBeTruthy();
    expect(screen.getAllByText("not read").length).toBe(3);
  });

  it("renders mesh fields as unknown when the node returned no health block", () => {
    const now = Date.now();
    useGroundStationStore.setState({
      role: {
        ...initial.role,
        info: { current: "relay", mesh_capable: true } as typeof initial.role.info,
        fetchedAt: now,
      },
      mesh: { ...initial.mesh, health: null, fetchedAt: now },
    });
    renderWithIntl(<GroundStationMeshCard />);
    expect(screen.getByText("Relay")).toBeTruthy();
    expect(screen.queryByText("Down")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.getAllByText("Unknown").length).toBe(3);
  });

  it("marks a snapshot that stopped refreshing as stale", () => {
    const old = Date.now() - 60_000;
    useGroundStationStore.setState({
      status: { ...initial.status, paired_drone: "drone-7" },
      statusFetchedAt: old,
    });
    renderWithIntl(<PairedDroneCard />);
    expect(screen.getByText("drone-7")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
  });

  it("shows a fresh reading without a freshness chip", () => {
    useGroundStationStore.setState({
      status: { ...initial.status, paired_drone: "drone-7" },
      statusFetchedAt: Date.now(),
    });
    renderWithIntl(<PairedDroneCard />);
    expect(screen.getByText("drone-7")).toBeTruthy();
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.queryByText("not read")).toBeNull();
  });
});

describe("ground-station overview poll", () => {
  it("refreshes the status, role, mesh and uplink slices the cards read", async () => {
    renderWithIntl(<GroundStationOverview />);
    expect(poll.run).not.toBeNull();
    // Response bodies as the agent's ground-station routes return them.
    const api = {
      getStatus: async () => ({
        paired_drone: "drone-7",
        profile: "ground-station",
        uplink_active: "eth0",
      }),
      getRole: async () => ({ current: "relay", mesh_capable: true }),
      getMeshHealth: async () => ({ up: true, peer_count: 2, partition: false }),
      getMeshNeighbors: async () => ({ neighbors: [] }),
      getMeshRoutes: async () => ({ routes: [] }),
      getMeshGateways: async () => ({ gateways: [], selected: null }),
      getNetwork: async () => ({ active_uplink: "eth0", priority: ["eth0"], ap: null }),
    };
    await poll.run!(api);
    const s = useGroundStationStore.getState();
    expect(s.status.paired_drone).toBe("drone-7");
    expect(s.statusFetchedAt).not.toBeNull();
    expect(s.role.fetchedAt).not.toBeNull();
    expect(s.mesh.fetchedAt).not.toBeNull();
    expect(s.mesh.health?.peer_count).toBe(2);
    expect(s.uplink.fetchedAt).not.toBeNull();
  });
});