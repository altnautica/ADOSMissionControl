/**
 * @module command/role-badge-selection.test
 * @description The top-bar ground-station role badge follows the selection: it
 * shows while the attached ground station is selected and hides over any other
 * node, including a second ground station.
 * @license GPL-3.0-only
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { RoleBadge } from "../RoleBadge";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

function selectProfile(profile: string, nodeId = "node:n1") {
  useDroneManager.setState({ selectedDroneId: nodeId });
  useNodeRegistryStore.setState({
    nodes: { [nodeId]: { presence: { profile, sources: ["local"] }, fc: {} } } as never,
  });
}

beforeEach(() => {
  useAgentConnectionStore.setState({ nodeDeviceId: "n1", agentUrl: "http://192.0.2.10:8080" });
  useGroundStationStore.setState((s) => ({
    status: { ...s.status, profile: "ground_station" },
    role: { ...s.role, info: { current: "receiver" } as never },
  }));
});

afterEach(() => {
  cleanup();
  useDroneManager.setState({ selectedDroneId: null });
  useNodeRegistryStore.setState({ nodes: {} });
  useAgentConnectionStore.setState({ nodeDeviceId: null, agentUrl: null });
});

describe("RoleBadge", () => {
  it("shows the role while a ground station is selected", () => {
    selectProfile("ground-station");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleBadge />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(messages.hardware.role.receiver);
  });

  it("hides over a compute node selection", () => {
    selectProfile("workstation");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleBadge />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    act(() => selectProfile("ground-station"));
    expect(screen.queryByRole("status")).not.toBeNull();
  });

  it("hides over a second ground station while the first is attached", () => {
    selectProfile("ground-station", "node:n2");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleBadge />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    act(() => selectProfile("ground-station"));
    expect(screen.queryByRole("status")).not.toBeNull();
  });
});
