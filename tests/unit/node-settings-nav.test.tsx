/**
 * Tests for the Settings tab's two-tier grouped navigation: the five groups,
 * the availability gates that hide feature pages a node does not advertise,
 * and page switching — with the page content itself unchanged (each nav item
 * renders the same section component the stacked layout used).
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

// happy-dom's localStorage.setItem is not a function in this config, so the
// persist middleware in local-nodes-store (whose storage is captured at import)
// would throw on setState. Install a working in-memory localStorage BEFORE the
// store modules load (vi.hoisted runs before imports).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

import { NodeSettingsTab } from "@/components/command/settings/NodeSettingsTab";
import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "@/components/command/settings/settings-nav";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const initialConnectionState = useAgentConnectionStore.getState();

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
  useAgentConnectionStore.setState({
    client: null,
    cloudMode: true,
    nodeDeviceId: "dev-unpaired",
  });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
  vi.restoreAllMocks();
});

function ctxWith(overrides: Partial<SettingsPageContext>): SettingsPageContext {
  return {
    droneId: "node:dev-1",
    profile: "drone",
    config: null,
    readOnly: false,
    setValue: async () => {},
    ...overrides,
  };
}

function gate(id: string) {
  const item = SETTINGS_NAV_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`no nav item ${id}`);
  return item.when ?? (() => true);
}

describe("settings nav availability gates", () => {
  it("hides the feature pages a node does not advertise", () => {
    const bare = ctxWith({ config: {} });
    expect(gate("world-model")(bare)).toBe(false);
    expect(gate("swarm")(bare)).toBe(false);

    const advertised = ctxWith({ config: { atlas: {}, swarm: {} } });
    expect(gate("world-model")(advertised)).toBe(true);
    expect(gate("swarm")(advertised)).toBe(true);
  });

  it("keeps the profile fits the pages already enforce", () => {
    const ws = ctxWith({ profile: "workstation", config: { atlas: {} } });
    expect(gate("video")(ws)).toBe(false);
    expect(gate("world-model")(ws)).toBe(false);
    expect(gate("vision-perception")(ws)).toBe(true);
    // A workstation carries no radio, so neither fleet-radio page appears.
    expect(gate("radio")(ws)).toBe(false);

    const gs = ctxWith({ profile: "ground-station" });
    // Video is the camera + encode page of a node that actually encodes. A
    // ground station relays video it never encodes, and every `video.wfb.*`
    // field it does own moved to the Radio page — so Video is drone-only and
    // Radio is what a ground station is offered instead.
    expect(gate("video")(gs)).toBe(false);
    expect(gate("radio")(gs)).toBe(true);
    expect(gate("vision-perception")(gs)).toBe(false);
  });
});

describe("NodeSettingsTab grouped navigation", () => {
  it("renders only the groups a profile actually fills, and switches pages without changing content", () => {
    renderWithIntl(
      <NodeSettingsTab droneId="dev-unpaired" profile="ground-station" />,
    );

    // A ground station fills four of the five groups. Every page in
    // "Video & vision" is drone-or-workstation gated (it encodes nothing and
    // runs no perception), so the group header is not rendered at all rather
    // than heading an empty list.
    expect(screen.getByText("Identity")).toBeTruthy();
    expect(screen.getByText("Link & network")).toBeTruthy();
    expect(screen.getByText("Cloud & remote")).toBeTruthy();
    expect(screen.getByText("System & safety")).toBeTruthy();
    expect(screen.queryByText("Video & vision")).toBeNull();

    // Ungated pages are offered; the un-advertised feature pages are not.
    expect(screen.getByText("Wi-Fi")).toBeTruthy();
    expect(screen.queryByText("World model")).toBeNull();
    expect(screen.queryByText("Swarm")).toBeNull();
    // The radio page is where a ground station's `video.wfb.*` fields live.
    expect(screen.getByText("Radio")).toBeTruthy();
    expect(screen.queryByText("Video")).toBeNull();

    // Default page: Profile (the same read-only section as before).
    expect(screen.getByText("Node profile")).toBeTruthy();

    // Switching pages renders the selected section's own content.
    fireEvent.click(screen.getByText("Security"));
    expect(screen.getByText("Pairing API key")).toBeTruthy();
    expect(screen.queryByText("Node profile")).toBeNull();
  });

  it("keeps the global no-path banner on every page", () => {
    renderWithIntl(
      <NodeSettingsTab droneId="dev-unpaired" profile="ground-station" />,
    );
    expect(
      screen.getByText(/configuration is read-only/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Cloud relay"));
    expect(
      screen.getByText(/configuration is read-only/),
    ).toBeTruthy();
  });
});
