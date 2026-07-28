/**
 * The Agent page after the sidebar flattening. It used to nest three sidebars:
 * the fleet list, this sub-nav, and a third one inside the `settings` sub-page.
 * The configuration pages are hoisted into this sub-nav, so what has to hold is
 * that there is exactly ONE nav no matter which page is open, that every hoisted
 * page is reachable from it, that the config-transport banners follow the pages
 * that actually read the config and appear nowhere else, and that the per-node
 * memory and deep-link handoff still resolve across the larger id space.
 *
 * The live surfaces are stubbed to a single line each: what is under test is the
 * navigation, and each surface's real body is covered by its own tests.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

// happy-dom's localStorage.setItem is not a function in this config, so the
// persist middleware in local-nodes-store / ui-prefs-store (whose storage is
// captured at import) would throw on setState. Install a working in-memory
// localStorage BEFORE the store modules load (vi.hoisted runs before imports).
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

// The live companion surfaces, each reduced to one identifiable line. They pull
// 3D viewers, video pipelines and Convex queries that have nothing to do with
// the sidebar under test.
vi.mock("@/components/command/SystemTab", () => ({
  SystemTab: () => <div>agent-health-body</div>,
}));
vi.mock("@/components/command/PluginsTab", () => ({
  PluginsTab: () => <div>agent-extensions-body</div>,
}));
vi.mock("@/components/drone-detail/LogsTab", () => ({
  LogsTab: () => <div>agent-logs-body</div>,
}));
vi.mock("@/components/dashboard/DroneRadioPanel", () => ({
  DroneRadioPanel: () => <div>agent-link-body</div>,
}));
vi.mock("@/components/drone-detail/DroneVisionTab", () => ({
  DroneVisionTab: () => <div>agent-perception-body</div>,
}));
vi.mock("@/components/drone-detail/cameras/CameraManagerTab", () => ({
  CameraManagerTab: () => <div>agent-cameras-body</div>,
}));
vi.mock("@/components/drone-detail/DroneWorldModelTab", () => ({
  DroneWorldModelTab: () => <div>agent-world-model-body</div>,
}));
vi.mock("@/components/drone-detail/DroneLiveWorldTab", () => ({
  DroneLiveWorldTab: () => <div>agent-live-world-body</div>,
}));

import { AgentTab } from "@/components/dashboard/node-detail/agent/AgentTab";
import type {
  NodeProfile,
  SurfaceContext,
} from "@/components/dashboard/node-detail/surface-types";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { useUiStore } from "@/stores/ui-store";
import { renderWithIntl } from "../helpers/intl-wrapper";
import en from "../../locales/en.json";

const NO_PATH = en.nodeSettings.readOnlyNoAgent;
const CONFIG_SUBTITLE = en.nodeSettings.subtitle;

const initialConnectionState = useAgentConnectionStore.getState();

/** A companion-backed node with every capability present, so the sidebar
 *  resolves the widest list the profile allows. There is deliberately no config
 *  transport (no direct client, no pairing record, no relay reach), which is
 *  what makes the read-only banner the one the banner tests assert on. */
function ctxFor(
  profile: NodeProfile,
  over: Partial<SurfaceContext> = {},
): SurfaceContext {
  return {
    droneId: `node:${profile}`,
    drone: { profile } as SurfaceContext["drone"],
    displayName: profile,
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: true,
    visionPresent: true,
    crsfPresent: true,
    role: "drone" as SurfaceContext["role"],
    showLockedTabs: false,
    isFeatureEnabled: () => true,
    atlasCapturing: true,
    ...over,
  };
}

const sectionHeaders = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("nav span")).map((s) => s.textContent);

const currentLabel = (container: HTMLElement) =>
  container.querySelector('[aria-current="page"]')?.textContent;

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
  useAgentConnectionStore.setState({
    client: null,
    cloudMode: true,
    nodeDeviceId: "dev-1",
  });
  useUiPrefsStore.setState({ lastAgentPanelByNode: {} });
  useUiStore.setState({ pendingAgentPanel: null });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
});

describe("the Agent page has one sidebar", () => {
  it("renders exactly one nav for a drone and keeps it at one when a config page opens", () => {
    const { container } = renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    expect(container.querySelectorAll("nav")).toHaveLength(1);

    // Opening a page that used to live behind the third sidebar must not
    // introduce a second nav — that regression IS the bug being fixed.
    fireEvent.click(screen.getByText("Cloud relay"));
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    fireEvent.click(screen.getByText("Security"));
    expect(container.querySelectorAll("nav")).toHaveLength(1);
  });

  it("renders exactly one nav for a ground station, with the sections that profile fills", () => {
    const { container } = renderWithIntl(
      <AgentTab ctx={ctxFor("ground-station")} />,
    );
    expect(container.querySelectorAll("nav")).toHaveLength(1);

    // A ground station encodes no video and runs no perception, so every page
    // under Video & vision is gated away and the header is not rendered at all.
    expect(sectionHeaders(container)).toEqual([
      "Overview",
      "Link & network",
      "Cloud & remote",
      "System & safety",
      "Software",
    ]);
    // Radio is what it gets instead of Video — its `video.wfb.*` fields live there.
    expect(screen.getByText("Radio")).toBeTruthy();
    expect(screen.queryByText("Video")).toBeNull();
  });

  it("groups a drone's live surfaces with the configuration for the same subsystem", () => {
    const { container } = renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    expect(sectionHeaders(container)).toEqual([
      "Overview",
      "Link & network",
      "Video & vision",
      "Cloud & remote",
      "System & safety",
      "Software",
    ]);

    // The live surface and its configuration are one click apart, not one
    // sidebar apart: Link above Radio, World Model above its setup page.
    const labels = Array.from(container.querySelectorAll("nav button")).map(
      (b) => b.textContent,
    );
    expect(labels.indexOf("Radio")).toBe(labels.indexOf("Link") + 1);
    expect(labels).toContain("World Model");
    expect(labels).toContain("Cameras");
    expect(labels).toContain("Vision & perception");
  });

  it("reaches every page that used to live behind the third sidebar", () => {
    renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    for (const label of [
      "Profile",
      "Radio",
      "Network",
      "Wi-Fi",
      "Cellular",
      "MAC pinning",
      "Discovery",
      "MAVLink",
      "Video",
      "Vision & perception",
      "Cloud relay",
      "Operating region",
      "Self-heal",
      "Security",
      "Advanced",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe("the config banners follow the pages that read the config", () => {
  it("shows the no-path banner on a config page and on no other page", () => {
    renderWithIntl(<AgentTab ctx={ctxFor("ground-station")} />);

    // Default page is Health — a live surface that never opens the config
    // document, so a "configuration is read-only" line above it would be false.
    expect(screen.getByText("agent-health-body")).toBeTruthy();
    expect(screen.queryByText(NO_PATH)).toBeNull();
    expect(screen.queryByText(CONFIG_SUBTITLE)).toBeNull();

    fireEvent.click(screen.getByText("Cloud relay"));
    expect(screen.getByText(NO_PATH)).toBeTruthy();
    expect(screen.getByText(CONFIG_SUBTITLE)).toBeTruthy();

    // Wi-Fi is a config page, but it scans and joins over the agent's own
    // network endpoints and never reads the config document — chrome yes,
    // config banner no.
    fireEvent.click(screen.getByText("Wi-Fi"));
    expect(screen.getByText(CONFIG_SUBTITLE)).toBeTruthy();
    expect(screen.queryByText(NO_PATH)).toBeNull();

    fireEvent.click(screen.getByText("Logs"));
    expect(screen.getByText("agent-logs-body")).toBeTruthy();
    expect(screen.queryByText(NO_PATH)).toBeNull();
  });
});

describe("deep links and per-node memory across the merged id space", () => {
  it("falls back to the first visible page when the remembered id no longer resolves", () => {
    // `settings` was the id of the retired sub-page that hosted the third
    // sidebar; a browser that remembers it must not render a blank pane.
    useUiPrefsStore.setState({
      lastAgentPanelByNode: { "node:ground-station": "settings" },
    });
    const { container } = renderWithIntl(
      <AgentTab ctx={ctxFor("ground-station")} />,
    );
    expect(currentLabel(container)).toBe("Health");
    expect(screen.getByText("agent-health-body")).toBeTruthy();
  });

  it("falls back when a remembered page is gated off for this node's profile", () => {
    // World model setup is drone-only; a ground station must not land on it.
    useUiPrefsStore.setState({
      lastAgentPanelByNode: { "node:ground-station": "world-model-config" },
    });
    const { container } = renderWithIntl(
      <AgentTab ctx={ctxFor("ground-station")} />,
    );
    expect(currentLabel(container)).toBe("Health");
  });

  it("opens a remembered configuration page directly", () => {
    useUiPrefsStore.setState({
      lastAgentPanelByNode: { "node:drone": "radio-config" },
    });
    const { container } = renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    expect(currentLabel(container)).toBe("Radio");
  });

  it("consumes a deep-link handoff to a hoisted configuration page", () => {
    useUiStore.setState({ pendingAgentPanel: "advanced" });
    const { container } = renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    expect(currentLabel(container)).toBe("Advanced");
    expect(useUiStore.getState().pendingAgentPanel).toBeNull();
  });

  it("remembers a hoisted configuration page per node", () => {
    renderWithIntl(<AgentTab ctx={ctxFor("drone")} />);
    fireEvent.click(screen.getByText("Security"));
    expect(
      useUiPrefsStore.getState().getLastAgentPanel("node:drone"),
    ).toBe("security");
  });
});
