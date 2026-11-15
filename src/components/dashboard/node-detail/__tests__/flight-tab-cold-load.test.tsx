/**
 * @module node-detail/flight-tab-cold-load.test
 * @description A cold open of a drone's Flight tab. The cockpit body is a
 * `next/dynamic` import with no `loading`, which Next renders without a
 * Suspense boundary of its own. With nothing in the panel to catch it, the tab
 * click (a sync update) suspends the whole root until the chunk arrives, and
 * every telemetry-driven commit meanwhile counts toward React's nested-update
 * limit: a slow chunk ends in "Maximum update depth exceeded". The panel must
 * catch the suspension inside the tab body, show a fallback there, and then
 * show the cockpit.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { use, useEffect, useState } from "react";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";

// The cockpit chunk, held back until the test releases it.
const chunk = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  return { ready, release };
});

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
});

vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/plugins/PluginHostProvider", () => ({
  PluginHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/plugins/DroneDetailTabHost", () => ({
  DroneDetailTabHeaders: () => null,
  DroneDetailTabBody: () => null,
  isPluginTabId: (id: string) => id.startsWith("plugin:"),
  pluginTabIds: () => [],
}));
vi.mock("@/hooks/use-plugin-contributions", () => ({ usePluginContributions: () => [] }));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => [],
  useLiveInstallRows: () => null,
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/hooks/use-forget-node", () => ({ useForgetNode: () => vi.fn() }));
vi.mock("@/hooks/use-node-control-authority", () => ({
  useNodeControlAuthorityNotice: () => ({ show: false }),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isDemoMode: () => true,
}));

// The real cockpit pulls in video, map and HUD stacks; the subject here is
// the lazy load path. A light body behind the real dynamic() suspends until
// the test releases its "chunk", which stands in for a slow chunk download.
vi.mock("@/components/cockpit/CockpitView", () => ({
  CockpitView: ({ droneId }: { droneId: string }) => {
    use(chunk.ready);
    return <div>{`cockpit-${droneId}`}</div>;
  },
}));

import { NodeDetailPanel } from "../NodeDetailPanel";
import { setFixtureFleet } from "../../../../../tests/helpers/fleet-drones";

vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
  (await import("../../../../../tests/helpers/fleet-drones")).fleetDronesModuleMock(await importOriginal()),
);
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import type { FleetDrone } from "@/lib/types";

const DRONE = "node:drone-1";

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  cleanup();
  setFixtureFleet({
    drones: [{ id: DRONE, name: DRONE, status: "online", profile: "drone" } as unknown as FleetDrone],
  });
  useUiPrefsStore.setState({ lastTabByNode: { [DRONE]: "overview" }, lastAgentPanelByNode: {} });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

/**
 * A telemetry tick in the same root as the panel: once started, one commit
 * per macrotask, as the shell's timers do.
 */
let startTicking: () => void = () => {};
function Ticker({ ticks, onDone }: { ticks: number; onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    startTicking = () => setStarted(true);
  }, []);
  useEffect(() => {
    if (!started) return;
    if (n >= ticks) {
      onDone();
      return;
    }
    const id = setTimeout(() => setN((v) => v + 1), 0);
    return () => clearTimeout(id);
  }, [started, n, ticks, onDone]);
  return null;
}

const depthErrors = () =>
  errorSpy.mock.calls.filter((args) =>
    args.some((a) => String(a instanceof Error ? a.message : a).includes("Maximum update depth")),
  );

describe("Flight tab cold load", () => {
  it("keeps the lazy cockpit's suspension inside the tab body while telemetry ticks", async () => {
    let ticked!: () => void;
    const done = new Promise<void>((r) => {
      ticked = r;
    });
    const { container } = render(
      <>
        <NodeDetailPanel droneId={DRONE} onClose={() => {}} />
        <Ticker ticks={80} onDone={ticked} />
      </>,
    );
    // Let the dynamic() loader resolve its module so only the chunk is pending.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    fireEvent.click(container.querySelector("#drone-tab-cockpit")!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The click commits: Flight is selected with a fallback in its body
    // rather than the whole root waiting on the chunk.
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(
      "drone-tab-cockpit",
    );
    expect(
      container.querySelector('[role="tabpanel"] [data-testid="surface-loading"]'),
    ).not.toBeNull();

    // Telemetry keeps committing while the chunk is still on its way.
    const uncaught: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      uncaught.push(e.error ?? e.message);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    startTicking();
    const finished = await Promise.race([
      done.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]);
    window.removeEventListener("error", onError);
    // A suspended root stops committing them; a boundary in the body does not.
    expect(finished).toBe(true);

    await act(async () => {
      chunk.release();
    });
    expect(await screen.findByText(`cockpit-${DRONE}`)).toBeTruthy();
    expect(depthErrors()).toEqual([]);
    expect(uncaught).toEqual([]);
  });
});
