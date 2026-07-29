/**
 * Tests for the node Settings "Perception setup" page: the consolidated
 * surface for the detector model + the perception offload / serving controls.
 * Covers the profile gates (nothing on a ground-station), the honest LAN
 * requirement for the detector picker, the honest "not offloading" state, and
 * the config-writer binding of the serving controls.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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

import { VisionPerceptionSection } from "@/components/command/settings/VisionPerceptionSection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const initialConnection = useAgentConnectionStore.getState();

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
  useAgentCapabilitiesStore.getState().clear();
  vi.restoreAllMocks();
});

const CONFIG = {
  perception: {
    offload: { enabled: "auto", compute_node_addr: null },
    serving: { enabled: "auto", detector_model: null },
  },
};

function renderSection(
  profile: "drone" | "ground-station" | "workstation",
  config: Record<string, unknown> | null = CONFIG,
) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <VisionPerceptionSection
      droneId="node:dev-1"
      profile={profile}
      config={config}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue, utils };
}

describe("VisionPerceptionSection profile gates", () => {
  it("renders nothing on a ground-station node", () => {
    const { utils } = renderSection("ground-station");
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders the consolidated drone page: detector + offload", () => {
    renderSection("drone");
    expect(screen.getByText("Perception setup")).toBeTruthy();
    expect(screen.getByText("Detector model")).toBeTruthy();
    // The "Offload" subsection heading plus its enable field label.
    expect(screen.getAllByText("Offload").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Pin workstation")).toBeTruthy();
  });

  it("renders the serving controls on a workstation node", () => {
    renderSection("workstation");
    expect(screen.getByText("Serve offloaded perception")).toBeTruthy();
    expect(screen.getByText("Detector model")).toBeTruthy();
    // GPU facts render only from real reported values — none here.
    expect(screen.queryByText("GPU")).toBeNull();
  });
});

describe("VisionPerceptionSection honesty", () => {
  it("states the LAN requirement instead of rendering a dead model picker", () => {
    // No agent URL in the connection store → no vision client resolves.
    renderSection("drone");
    expect(
      screen.getByText(/needs the node's LAN connection/),
    ).toBeTruthy();
  });

  it("shows 'not offloading' when the agent reports no active target", () => {
    renderSection("drone");
    expect(screen.getByText("not offloading")).toBeTruthy();
  });

  it("shows the agent-reported active offload target verbatim", () => {
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ perceptionOffloadTarget: "bench-ws:8092" });
    renderSection("drone");
    expect(screen.getByText("bench-ws:8092")).toBeTruthy();
  });
});
