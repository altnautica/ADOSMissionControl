/**
 * The headless connection layer every route depends on: each bridge mounts
 * exactly once, auto-reconnect runs, and the demo engine loads only when demo
 * mode is on. Without these a page opened in a fresh tab starts with empty
 * stores and never sees a vehicle.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React, { Suspense } from "react";

const env = vi.hoisted(() => ({ autoReconnect: 0 }));

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType>) => {
    const Lazy = React.lazy(async () => ({ default: await loader() }));
    return (props: Record<string, unknown>) => (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  },
}));

vi.mock("@/hooks/use-auto-reconnect", () => ({
  useAutoReconnect: () => {
    env.autoReconnect++;
  },
}));
vi.mock("@/components/layout/DemoResidueSweep", () => ({
  DemoResidueSweep: () => null,
}));
vi.mock("@/components/layout/DemoProvider", () => ({
  DemoProvider: () => <i data-testid="bridge-demo" />,
}));
vi.mock("@/components/command/AgentMavlinkBridge", () => ({
  AgentMavlinkBridge: () => <i data-testid="bridge-agent-mavlink" />,
}));
vi.mock("@/components/command/AgentBridges", () => ({
  AgentBridges: () => <i data-testid="bridge-agent" />,
}));
vi.mock("@/components/dashboard/CloudDroneBridge", () => ({
  CloudDroneBridge: () => <i data-testid="bridge-cloud-drone" />,
}));
vi.mock("@/components/dashboard/LocalDroneBridge", () => ({
  LocalDroneBridge: () => <i data-testid="bridge-local-drone" />,
}));
vi.mock("@/components/dashboard/RelayedDroneBridge", () => ({
  RelayedDroneBridge: () => <i data-testid="bridge-relayed-drone" />,
}));
vi.mock("@/components/dashboard/RelayedMavlinkBridge", () => ({
  RelayedMavlinkBridge: () => <i data-testid="bridge-relayed-mavlink" />,
}));

import { ShellBridges } from "@/components/layout/ShellBridges";
import { useSettingsStore } from "@/stores/settings-store";

const BRIDGES = [
  "bridge-agent-mavlink",
  "bridge-agent",
  "bridge-cloud-drone",
  "bridge-local-drone",
  "bridge-relayed-drone",
  "bridge-relayed-mavlink",
];

afterEach(() => {
  cleanup();
  env.autoReconnect = 0;
  useSettingsStore.setState({ demoMode: false });
});

describe("ShellBridges", () => {
  it("mounts every connection bridge, auto-reconnect and the demo engine once", async () => {
    useSettingsStore.setState({ demoMode: true, _hasHydrated: true });
    render(<ShellBridges />);

    for (const id of BRIDGES) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
    expect(await screen.findByTestId("bridge-demo")).toBeTruthy();
    expect(env.autoReconnect).toBeGreaterThan(0);
  });

  it("does not load the demo engine when demo mode is off", () => {
    useSettingsStore.setState({ demoMode: false, _hasHydrated: true });
    render(<ShellBridges />);
    expect(screen.getAllByTestId("bridge-agent")).toHaveLength(1);
    expect(screen.queryByTestId("bridge-demo")).toBeNull();
  });
});
