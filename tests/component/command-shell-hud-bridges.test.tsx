/**
 * The chromeless kiosk HUD route skips the GCS chrome but must still mount
 * the headless connection bridges. A HUD opened in a fresh tab (or loaded
 * directly by the SBC kiosk) starts with empty stores; without the bridges no
 * vehicle, telemetry or video ever reaches it.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React, { Suspense } from "react";

const env = vi.hoisted(() => ({ pathname: "/hud", autoReconnect: 0 }));

// Persisted stores imported by the shell chrome hydrate from IndexedDB, which
// jsdom does not provide.
vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    createStore: vi.fn(() => ({})),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => env.pathname,
  useRouter: () => ({ push: () => {} }),
}));
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
vi.mock("@/components/dashboard/FleetProjectionBridge", () => ({
  FleetProjectionBridge: () => <i data-testid="bridge-fleet-projection" />,
}));

import { CommandShell } from "@/components/layout/CommandShell";

const BRIDGES = [
  "bridge-agent-mavlink",
  "bridge-agent",
  "bridge-cloud-drone",
  "bridge-local-drone",
  "bridge-relayed-drone",
  "bridge-relayed-mavlink",
  "bridge-fleet-projection",
];

afterEach(() => {
  cleanup();
  env.autoReconnect = 0;
});

describe("CommandShell on the chromeless HUD route", () => {
  it("mounts every connection bridge, auto-reconnect and the demo engine once", async () => {
    render(
      <CommandShell>
        <div data-testid="hud-page" />
      </CommandShell>,
    );

    expect(screen.getByTestId("hud-page")).toBeTruthy();
    for (const id of BRIDGES) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
    expect(await screen.findByTestId("bridge-demo")).toBeTruthy();
    expect(env.autoReconnect).toBeGreaterThan(0);
  });
});
