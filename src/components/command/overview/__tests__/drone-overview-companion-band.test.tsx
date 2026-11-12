/**
 * @module overview/drone-overview-companion-band.test
 * @description The companion band reads the attached agent connection, so it
 * renders only when that connection belongs to the node on screen. Another
 * node's page (relayed, another LAN node) shows the unreachable notice rather
 * than the attached agent's status, services and Restart controls.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup } from "@testing-library/react";

// Several stores under the overview are persisted; bind a deterministic
// in-memory localStorage before the store modules resolve the global.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});


// The vehicle cards read live stores of their own; stand them in so this test
// pins only where the Overview places them.
vi.mock("@/components/flight/CompactInfoCards", () => ({
  CompactInfoCards: () => <div data-testid="info-cards" />,
}));
vi.mock("@/components/command/shared/StatusTextCard", () => ({
  StatusTextCard: () => <div data-testid="status-text-card" />,
}));
vi.mock("@/components/command/shared/RcInputCard", () => ({
  RcInputCard: () => <div data-testid="rc-input-card" />,
}));

// The band's live cards poll stores of their own; stand them in so the test
// pins only whether the band renders.
vi.mock("@/components/command/shared/AgentStatusCard", () => ({
  AgentStatusCard: () => <div data-testid="companion-band" />,
}));

import messages from "../../../../../locales/en.json";
import { DroneOverview } from "../DroneOverview";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const NODE_ID = "node:drone-b";

function ctx(): SurfaceContext {
  return {
    droneId: NODE_ID,
    drone: { _id: NODE_ID, deviceId: "drone-b", name: "Drone B", agentIdentityKnown: true },
    displayName: "Drone B",
    isConnected: false,
    firmwareType: null,
    agentDeviceId: "drone-b",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent: "absent",
    gnssPresent: "absent",
    loraPresent: "absent",
    role: "drone",
    capabilitiesKnown: true,
    showLockedTabs: false,
  } as unknown as SurfaceContext;
}

function attach(nodeDeviceId: string): void {
  useAgentConnectionStore.setState({
    nodeDeviceId,
    agentUrl: "http://agent.local:8080",
    apiKey: null,
    client: null,
  } as never);
}

function renderOverview() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneOverview ctx={ctx()} />
    </NextIntlClientProvider>,
  );
}

describe("drone Overview companion band", () => {
  afterEach(() => {
    cleanup();
    useAgentConnectionStore.setState({ nodeDeviceId: null, agentUrl: null } as never);
  });

  it("shows the unreachable notice, not the attached agent, on another node's page", () => {
    attach("drone-a");
    renderOverview();
    expect(screen.getByText(messages.dronePanel.companionOffline.title)).toBeTruthy();
    expect(screen.queryByTestId("companion-band")).toBeNull();
  });

  it("shows the band when the attached agent is this node's", () => {
    attach("drone-b");
    renderOverview();
    expect(screen.queryByText(messages.dronePanel.companionOffline.title)).toBeNull();
  });
});
