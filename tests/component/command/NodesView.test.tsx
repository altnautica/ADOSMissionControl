/**
 * Render tests for the fleet-operations board.
 *
 * These run against the real English catalogue, so a control whose label or
 * reason key is missing fails here rather than reaching an operator as a raw
 * key. They also pin the board's honesty rules: an unreachable node's controls
 * are disabled and say why, and a node with no live reading shows nothing
 * rather than a stale number.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The pairing stores are persisted; the DOM shim here exposes a localStorage
// whose methods are undefined, so bind a usable one before they are imported.
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
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

// The board's command lane holds a Convex mutation handle; the tests drive the
// LAN lane, so the queue is simply absent.
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@/app/ConvexClientProvider", () => ({
  useConvexAvailable: () => false,
}));

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { NodesView } from "@/components/command/nodes-view/NodesView";
import { registerBuiltins } from "@/lib/skills";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const NOW = Date.now();

const DRONE: FleetNodeEntry = {
  _id: "node:alpha",
  userId: "local",
  deviceId: "alpha",
  name: "Alpha",
  apiKey: "key-alpha",
  pairedAt: 1,
  lastSeen: NOW,
  profile: "drone",
  isLocal: true,
  fcFirmware: "ardupilot",
  frameType: "copter",
} as FleetNodeEntry;

const GROUND: FleetNodeEntry = {
  _id: "node:bravo",
  userId: "local",
  deviceId: "bravo",
  name: "Bravo",
  apiKey: "",
  pairedAt: 2,
  lastSeen: NOW,
  profile: "ground-station",
  role: "relay",
  isLocal: false,
} as FleetNodeEntry;

function lanNode(deviceId: string): LocalNode {
  return {
    deviceId,
    name: deviceId,
    hostname: `http://${deviceId}.example:8080`,
    apiKey: `key-${deviceId}`,
    profile: "drone",
    pairedAt: 1,
  } as LocalNode;
}

function renderBoard(nodes: FleetNodeEntry[] = [DRONE, GROUND]) {
  return renderWithIntl(
    <NodesView
      fleetNodes={nodes}
      onOpenAgent={() => {}}
      onOpenPairing={() => {}}
    />,
  );
}

/** The row whose identity cell carries `name`. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByRole("button", { name });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  registerBuiltins();
  // Only the drone is LAN-paired, so the ground station has no command lane.
  useLocalNodesStore.setState({ nodes: [lanNode("alpha")] });
  useCommandFleetStore.setState({
    cloudStatuses: {
      alpha: {
        deviceId: "alpha",
        updatedAt: NOW,
        telemetry: {
          armed: false,
          mode: "LOITER",
          battery: { remaining: 74, voltage: 22.1 },
        },
      },
      bravo: { deviceId: "bravo", updatedAt: NOW },
    },
    telemetryByDeviceId: {},
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("NodesView", () => {
  it("renders one row per node with its reach", () => {
    renderBoard();

    expect(within(rowFor("Alpha")).getByText("Direct · LAN")).toBeTruthy();
    // No LAN credentials and no cloud queue: unreachable, not "cloud".
    expect(within(rowFor("Bravo")).getByText("Unreachable")).toBeTruthy();
  });

  it("shows a node's own flight state, and nothing for a node without one", () => {
    renderBoard();

    expect(within(rowFor("Alpha")).getByText("LOITER")).toBeTruthy();
    expect(within(rowFor("Alpha")).getByText("74%")).toBeTruthy();
    // The ground station reports no telemetry, so the cells stay empty rather
    // than borrowing the drone's numbers.
    expect(within(rowFor("Bravo")).queryByText("74%")).toBeNull();
  });

  it("offers the mode presets and the recoveries on a reachable node", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(
      within(rowFor("Alpha")).getByRole("button", {
        name: /change alpha flight mode/i,
      }),
    );

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Loiter" })).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: /return to home/i }),
    ).toBeTruthy();
  });

  it("disables an unreachable node's actions and names the cause", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(
      within(rowFor("Bravo")).getByRole("button", { name: /bravo actions/i }),
    );

    const item = within(screen.getByRole("menu")).getByRole("menuitem", {
      name: /return to home/i,
    });
    expect(item).toHaveProperty("disabled", true);
    expect(item.getAttribute("title")).toMatch(/not paired|cloud/i);
  });

  it("narrows the board by search", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.type(screen.getByRole("searchbox"), "alpha");

    expect(screen.queryByRole("button", { name: "Bravo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
  });

  it("shows the bulk bar only once a row is selected", async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(screen.queryByText(/selected/i)).toBeNull();

    await user.click(
      within(rowFor("Alpha")).getByRole("checkbox", { name: /select alpha/i }),
    );

    expect(screen.getByText("1 selected")).toBeTruthy();
  });
});
