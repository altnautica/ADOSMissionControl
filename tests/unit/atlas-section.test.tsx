/**
 * Tests for the node "World model setup" page: the capability gate (renders
 * only when the node's config surface advertises the world-model block, drone
 * profile only), the relocated master feature switch, the writable pose-source
 * preference, and the read-only capture tuning rows that defer to the World
 * Model tab's own writer.
 *
 * The page is titled "World model setup", not "World model": it now sits one row
 * under the live World Model surface in the Agent sidebar, and two adjacent rows
 * reading the same thing is the confusion that naming resolves.
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

import { AtlasSection } from "@/components/command/settings/AtlasSection";
import { configAdvertises } from "@/components/command/settings/use-node-config";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ATLAS_CONFIG = {
  atlas: {
    enabled: false,
    capture_profile: "freeform",
    reconstruct_steps: 30000,
    pose_tier: "auto",
  },
};

function renderSection(
  profile: "drone" | "ground-station" | "workstation",
  config: Record<string, unknown> | null,
) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <AtlasSection
      droneId="node:dev-1"
      profile={profile}
      config={config}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue, utils };
}

describe("configAdvertises", () => {
  it("is true only for a present nested section object", () => {
    expect(configAdvertises(ATLAS_CONFIG, "atlas")).toBe(true);
    expect(configAdvertises({}, "atlas")).toBe(false);
    expect(configAdvertises(null, "atlas")).toBe(false);
    expect(configAdvertises({ atlas: "yes" }, "atlas")).toBe(false);
    expect(configAdvertises({ atlas: [] }, "atlas")).toBe(false);
  });
});

describe("AtlasSection capability gate", () => {
  it("renders nothing when the node does not advertise the block", () => {
    const { utils } = renderSection("drone", {});
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders nothing while the config has not loaded", () => {
    const { utils } = renderSection("drone", null);
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders nothing on a non-drone profile even when advertised", () => {
    const { utils } = renderSection("workstation", ATLAS_CONFIG);
    expect(utils.container.innerHTML).toBe("");
  });
});

describe("AtlasSection content", () => {
  it("hosts the master feature switch and the pose-source select", () => {
    renderSection("drone", ATLAS_CONFIG);
    expect(screen.getByText("World model setup")).toBeTruthy();
    expect(screen.getByText("World Model")).toBeTruthy();
    // The feature row is honest about an unreachable node.
    expect(screen.getByText("Pair on LAN")).toBeTruthy();
    expect(screen.getByText("Pose source")).toBeTruthy();
  });

  it("shows capture tuning read-only and points at the owning tab", () => {
    renderSection("drone", ATLAS_CONFIG);
    // The stored values, decoded — not editable fields.
    expect(screen.getByText("Freeform")).toBeTruthy();
    expect(screen.getByText("30000")).toBeTruthy();
    expect(screen.getByText(/managed on the World Model tab/)).toBeTruthy();
  });
});
