/**
 * @module cockpit/quick-settings-plugin-id.test
 * @description The drone-manager selection id is `node:<deviceId>`, while
 * plugin install rows are stored under the bare device id. A cockpit plugin
 * surface that queried installs with the selection id matched no row, so no
 * plugin parameters, panels or overlays ever mounted.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

const INSTALL_ROWS = [
  {
    installId: "install-1",
    pluginId: "com.example.follow",
    version: "1.0.0",
    name: "Follow",
    gcsContributes: [{ slot: "node.detail.tab", panelId: "follow", title: "Follow" }],
    gcsParameters: [
      {
        key: "distance",
        schema: { type: "number", minimum: 1, maximum: 50, default: 10 },
        binding: "plugin.config",
        ui: { label: "Distance" },
      },
    ],
  },
];

// The install table answers by exact device id, as the Convex index does.
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: (
    _ref: unknown,
    opts?: { args?: { deviceId?: string }; enabled?: boolean },
  ) => (opts?.enabled && opts.args?.deviceId === "abc" ? INSTALL_ROWS : undefined),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));
vi.mock("@/hooks/use-local-agent-plugins", () => ({ useLocalAgentPlugins: () => null }));
vi.mock("@/hooks/use-plugin-contributions", () => ({ usePluginContributions: () => [] }));
vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/plugins/parameters/PluginParametersPanel", () => ({
  PluginParametersPanel: ({ droneId, pluginId }: { droneId: string; pluginId: string }) => (
    <div data-testid="params">{`${droneId}|${pluginId}`}</div>
  ),
}));

import { CockpitQuickSettings } from "../CockpitQuickSettings";
import { useDroneManager } from "@/stores/drone-manager";

afterEach(() => {
  cleanup();
  useDroneManager.setState({ selectedDroneId: null });
});

describe("CockpitQuickSettings plugin id namespace", () => {
  it("mounts a bare-id install row's parameters for a node-id selection", () => {
    useDroneManager.setState({ selectedDroneId: "node:abc" });
    renderWithIntl(<CockpitQuickSettings onClose={() => {}} />);
    // The card renders, and its config writes address the bare device id.
    expect(screen.getByTestId("params").textContent).toBe("abc|com.example.follow");
  });
});
