/**
 * @license GPL-3.0-only
 *
 * Settings › Extensions in demo mode lists the demo nodes' installs (the same
 * fixtures their Agent › Extensions tab shows) instead of "Nothing installed".
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";

vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isDemoMode: () => true,
}));
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: false }),
}));
vi.mock("@/stores/local-plugin-installs-store", () => ({
  useLocalPluginInstallsStore: (sel: (s: { installs: unknown[] }) => unknown) => sel({ installs: [] }),
}));
vi.mock("@/hooks/use-node-plugin-list", () => ({ useLanNodePluginLists: () => ({}) }));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/components/dashboard/drone-plugins/RegistryPluginGrid", () => ({ RegistryPluginGrid: () => null }));
vi.mock("../installed-item", () => ({
  InstalledItem: ({ install }: { install: { name: string } }) => <span>{install.name}</span>,
}));

import PluginsIndexPage from "../page";

describe("Settings › Extensions · demo", () => {
  it("lists the demo nodes' installs grouped by node", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PluginsIndexPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Alpha-01" })).toBeInTheDocument();
    expect(screen.getByText("Telemetry Logger")).toBeInTheDocument();
    expect(screen.queryByText(messages.plugins.emptyTitle)).toBeNull();
  });
});
