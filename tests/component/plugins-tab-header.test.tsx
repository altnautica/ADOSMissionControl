/**
 * The Agent › Extensions header names the node the way the node header does
 * (the fleet display name), never the agent's own name or its raw id.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/hooks/use-surface-gate", () => ({ useSurfaceGate: () => ({ state: "ok" }) }));
vi.mock("@/components/command/shared/agent-gate-fallback", () => ({
  agentGateFallback: () => null,
}));
vi.mock("@/components/dashboard/drone-plugins/DronePluginsList", () => ({
  DronePluginsList: () => null,
}));
vi.mock("@/components/dashboard/drone-plugins/InstallPluginButton", () => ({
  InstallPluginButton: () => null,
}));
vi.mock("@/components/dashboard/drone-plugins/RegistryPluginGrid", () => ({
  RegistryPluginGrid: () => null,
}));
vi.mock("@/components/plugins/DronePluginParametersSection", () => ({
  DronePluginParametersSection: () => null,
}));

import messages from "../../locales/en.json";
import { PluginsTab } from "@/components/command/PluginsTab";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";

afterEach(cleanup);

describe("PluginsTab header", () => {
  it("uses the fleet display name", () => {
    const ctx = {
      droneId: "node:alpha-1",
      drone: { _id: "node:alpha-1", id: "node:alpha-1", name: "alpha-1" },
      displayName: "Alpha-01",
    } as unknown as SurfaceContext;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PluginsTab ctx={ctx} />
      </NextIntlClientProvider>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("Alpha-01");
    expect(heading.textContent).not.toContain("alpha-1");
  });
});
