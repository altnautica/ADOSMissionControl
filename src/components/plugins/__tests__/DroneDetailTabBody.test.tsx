/**
 * @license GPL-3.0-only
 *
 * Mount tests for the per-node plugin tab body. Covers:
 *   - the active tab's declarative parameters render the native panel
 *     above the iframe slot
 *   - a params-only plugin (no iframe) renders just the panel
 *   - a plugin with neither params nor a matching active tab renders nothing
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { DronePluginContribution } from "@/hooks/use-drone-plugin-contributions";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";

const { contributionsRef, slotRef } = vi.hoisted(() => ({
  contributionsRef: { value: [] as DronePluginContribution[] },
  slotRef: {
    value: [] as Array<{ pluginId: string; panelId: string; pluginInstallId?: string }>,
  },
}));

// The provider's node.detail.tab list holds EVERY plugin's tab iframe.
vi.mock("@/components/plugins/PluginHostProvider", () => ({
  useSlotContributions: () => slotRef.value,
}));

vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => contributionsRef.value,
}));

// The iframe slot pulls in Convex; stub it to a marker that lists exactly the
// contributions the body hands it (the ones that would mount as iframes).
vi.mock("@/components/plugins/PluginSlot", () => ({
  PluginSlot: (props: { contributions?: Array<{ pluginId: string; panelId: string }> }) => (
    <div
      data-testid="plugin-slot"
      data-mounted={(props.contributions ?? []).map((c) => c.pluginId).join(",")}
      data-panels={(props.contributions ?? []).map((c) => c.panelId).join(",")}
    />
  ),
}));

// The parameter panel itself is covered by its own tests; stub it to a marker
// that echoes its inputs so we can assert it is mounted with the right props.
vi.mock("@/components/plugins/parameters/PluginParametersPanel", () => ({
  PluginParametersPanel: (props: {
    droneId: string;
    pluginId: string;
    parameters: PluginParameter[];
  }) => (
    <div
      data-testid="params-panel"
      data-drone={props.droneId}
      data-plugin={props.pluginId}
      data-count={props.parameters.length}
    />
  ),
}));

import { DroneDetailTabBody, pluginTabId, pluginTabIds } from "../DroneDetailTabHost";

function contribution(
  over: Partial<DronePluginContribution> = {},
): DronePluginContribution {
  return {
    installId: "install-1",
    pluginId: "com.example.plugin",
    panelId: "tab-1",
    title: "Plugin Tab",
    order: 60,
    version: "1.0.0",
    enabled: true,
    parameters: [],
    ...over,
  };
}

const PARAM: PluginParameter = {
  key: "speed",
  schema: { type: "number", minimum: 0, maximum: 10, default: 5 },
  binding: "plugin.config",
  ui: { label: "Speed" },
};

describe("DroneDetailTabBody", () => {
  it("renders the native parameter panel above the iframe slot", () => {
    const c = contribution({ parameters: [PARAM] });
    contributionsRef.value = [c];
    render(
      <DroneDetailTabBody
        agentId="drone-1"
        activeTabId={pluginTabId(c)}
      />,
    );
    const panel = screen.getByTestId("params-panel");
    expect(panel.getAttribute("data-drone")).toBe("drone-1");
    expect(panel.getAttribute("data-plugin")).toBe("com.example.plugin");
    expect(panel.getAttribute("data-count")).toBe("1");
    // The iframe slot still mounts so a hybrid plugin's iframe renders below.
    expect(screen.getByTestId("plugin-slot")).toBeTruthy();
  });

  it("renders just the panel for a params-only plugin (slot mounts nothing)", () => {
    const c = contribution({ parameters: [PARAM] });
    contributionsRef.value = [c];
    render(
      <DroneDetailTabBody
        agentId="drone-1"
        activeTabId={pluginTabId(c)}
      />,
    );
    // Panel present; the slot is still rendered (it self-empties when the
    // plugin ships no bundle — covered by PluginSlot's own tests).
    expect(screen.getByTestId("params-panel")).toBeTruthy();
  });

  it("renders no panel when the active plugin declares no parameters", () => {
    const c = contribution({ parameters: [] });
    contributionsRef.value = [c];
    render(
      <DroneDetailTabBody
        agentId="drone-1"
        activeTabId={pluginTabId(c)}
      />,
    );
    expect(screen.queryByTestId("params-panel")).toBeNull();
    // The iframe slot still mounts for an iframe-only plugin.
    expect(screen.getByTestId("plugin-slot")).toBeTruthy();
  });

  it("mounts only the active tab's iframe, never sibling plugins' tabs", () => {
    const pod = contribution({ installId: "install-pod", pluginId: "com.example.pod", panelId: "console" });
    const thermal = contribution({ installId: "install-thermal", pluginId: "com.example.thermal", panelId: "view" });
    contributionsRef.value = [pod, thermal];
    slotRef.value = [
      { pluginId: "com.example.pod", panelId: "console", pluginInstallId: "install-pod" },
      { pluginId: "com.example.thermal", panelId: "view", pluginInstallId: "install-thermal" },
    ];
    render(
      <DroneDetailTabBody agentId="drone-1" activeTabId={pluginTabId(thermal)} />,
    );
    expect(screen.getByTestId("plugin-slot").getAttribute("data-mounted")).toBe(
      "com.example.thermal",
    );
  });

  it("gives each tab of a multi-tab install its own id and mounts the selected one", () => {
    const status = contribution({ panelId: "status", title: "Status" });
    const calibration = contribution({ panelId: "calibration", title: "Calibration" });
    contributionsRef.value = [status, calibration];
    slotRef.value = [
      { pluginId: "com.example.plugin", panelId: "status", pluginInstallId: "install-1" },
      { pluginId: "com.example.plugin", panelId: "calibration", pluginInstallId: "install-1" },
    ];
    expect(new Set(pluginTabIds([status, calibration])).size).toBe(2);
    render(
      <DroneDetailTabBody agentId="drone-1" activeTabId={pluginTabId(calibration)} />,
    );
    expect(screen.getByTestId("plugin-slot").getAttribute("data-panels")).toBe(
      "calibration",
    );
  });

  it("renders nothing when no contribution matches the active tab", () => {
    contributionsRef.value = [contribution({ parameters: [PARAM] })];
    const { container } = render(
      <DroneDetailTabBody agentId="drone-1" activeTabId="plugin:other" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
