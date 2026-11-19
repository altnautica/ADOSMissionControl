/**
 * @license GPL-3.0-only
 *
 * Render tests for the demo-mode registry catalog. It renders through the
 * same `RegistryCatalogBrowser` as the live grid, so it must carry the search
 * box, the category chips, and an Installed marker on every plugin the demo
 * drone's fixture install list carries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, within } from "@testing-library/react";
import messages from "../../../../../locales/en.json";

import { DEMO_REGISTRY_ENTRIES } from "@/mock/first-party-registry";
import { getDemoDronePluginInstalls } from "@/mock/mock-plugins";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";

// The install pop-up is exercised by its own tests; here it only has to
// report whether the grid opened it, and for which plugin.
vi.mock("@/components/plugins/PluginInstallDialog", () => ({
  PluginInstallDialog: (props: {
    open: boolean;
    initialSource?: { pluginId: string };
  }) =>
    props.open ? (
      <div data-testid="install-dialog">{props.initialSource?.pluginId}</div>
    ) : null,
}));

import { DemoRegistryGrid } from "../DemoRegistryGrid";

const browse = messages.pluginRegistry.browse;
const DRONE = "alpha-1";

function renderGrid(deviceId: string | null = DRONE) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DemoRegistryGrid
        target={deviceId ? { _id: deviceId, deviceId, name: "Demo" } : null}
      />
    </NextIntlClientProvider>,
  );
}

function cardIds(): string[] {
  return Array.from(document.querySelectorAll("li[data-plugin-id]")).map(
    (li) => li.getAttribute("data-plugin-id") ?? "",
  );
}

function card(pluginId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `li[data-plugin-id="${pluginId}"]`,
  );
  if (!el) throw new Error(`no card for ${pluginId}`);
  return el;
}

describe("DemoRegistryGrid", () => {
  beforeEach(() => {
    useLocalPluginInstallsStore.setState({ installs: [] });
  });

  it("renders the search box, every category chip, and the full fixture", () => {
    renderGrid();
    expect(screen.getByRole("searchbox", { name: browse.searchPlaceholder }))
      .toBeTruthy();
    const filters = screen.getByRole("group", { name: "Filter" });
    for (const label of Object.values(browse.category)) {
      expect(within(filters).getByRole("button", { name: label })).toBeTruthy();
    }
    expect(cardIds()).toEqual(DEMO_REGISTRY_ENTRIES.map((e) => e.row.plugin_id));
  });

  it("marks exactly the plugins the demo drone has installed", () => {
    renderGrid();
    const installed = new Set(
      getDemoDronePluginInstalls(DRONE).map((p) => p.pluginId),
    );
    const catalogIds = DEMO_REGISTRY_ENTRIES.map((e) => e.row.plugin_id);
    // The fixture must overlap the drone's installs or this test proves nothing.
    expect(catalogIds.some((id) => installed.has(id))).toBe(true);
    for (const id of catalogIds) {
      const pill = within(card(id)).queryByText(browse.card.installedPill);
      expect(Boolean(pill)).toBe(installed.has(id));
    }
  });

  it("shows no Installed marker without a target drone", () => {
    renderGrid(null);
    expect(screen.queryByText(browse.card.installedPill)).toBeNull();
  });

  it("filters by search text and shows the empty state when nothing matches", () => {
    renderGrid();
    const search = screen.getByRole("searchbox", {
      name: browse.searchPlaceholder,
    });
    fireEvent.change(search, { target: { value: "Lepton" } });
    expect(cardIds()).toEqual(["com.altnautica.thermal-flir-lepton-usb"]);

    fireEvent.change(search, { target: { value: "no-such-extension" } });
    expect(cardIds()).toEqual([]);
    expect(screen.getByText(browse.empty.title)).toBeTruthy();
  });

  it("filters by category chip", () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: browse.category.ai }));
    const expected = DEMO_REGISTRY_ENTRIES.filter(
      (e) => e.row.category === "ai",
    ).map((e) => e.row.plugin_id);
    expect(expected.length).toBeGreaterThan(0);
    expect(cardIds()).toEqual(expected);
    expect(
      screen
        .getByRole("button", { name: browse.category.ai })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("opens the install pop-up for the clicked card", () => {
    renderGrid();
    fireEvent.click(
      within(card("com.altnautica.siyi-pod")).getByRole("button"),
    );
    expect(screen.getByTestId("install-dialog").textContent).toBe(
      "com.altnautica.siyi-pod",
    );
  });
});
