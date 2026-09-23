/**
 * CockpitLayoutEditor: the chrome-card toggles still work, and the arrangeable
 * widgets section renders a zone picker + a show/hide toggle per registered
 * arrangeable widget, writing the per-loadout override via setLoadoutWidget.
 *
 * @license GPL-3.0-only
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

// Persist middleware writes through idb-keyval; mock it so the store hydrates
// without a real IndexedDB.
vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: vi.fn(async (k: string) => void store.delete(k)),
    clear: vi.fn(async () => store.clear()),
    keys: vi.fn(async () => [...store.keys()]),
    entries: vi.fn(async () => [...store.entries()]),
  };
});

import messages from "../../../../locales/en.json";
import { CockpitLayoutEditor } from "@/components/cockpit/CockpitLayoutEditor";
import {
  isCockpitWidgetVisible,
  useCockpitWidgetRegistry,
} from "@/lib/cockpit/widget-registry";
import { BUILTIN_WIDGETS } from "@/components/cockpit/CockpitZones";
import { useSettingsStore } from "@/stores/settings-store";
import {
  cloneDefaultLoadout,
  DEFAULT_LOADOUT_ID,
} from "@/stores/settings/keybindings-slice";

function wrap(node: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

function clearRegistry(): void {
  const { items, unregister } = useCockpitWidgetRegistry.getState();
  for (const id of [...items.keys()]) unregister(id);
}

function resetLoadouts(): void {
  useSettingsStore.setState({
    loadouts: { [DEFAULT_LOADOUT_ID]: cloneDefaultLoadout() },
    activeLoadoutId: DEFAULT_LOADOUT_ID,
  });
}

describe("CockpitLayoutEditor", () => {
  beforeEach(() => {
    clearRegistry();
    resetLoadouts();
    useCockpitWidgetRegistry.getState().register({
      id: "test.chip",
      zone: "top-left",
      source: "builtin",
      arrangeable: true,
      title: "Test Chip",
      render: () => null,
    });
    // A non-arrangeable widget must NOT appear in the widgets section.
    useCockpitWidgetRegistry.getState().register({
      id: "test.hud",
      zone: "center",
      source: "builtin",
      render: () => null,
    });
  });
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("renders the chrome-card toggles", () => {
    render(wrap(<CockpitLayoutEditor />));
    expect(screen.getByText("Cockpit layout")).toBeTruthy();
    expect(screen.getByText("Minimap")).toBeTruthy();
  });

  it("lists only arrangeable widgets with a zone label", () => {
    render(wrap(<CockpitLayoutEditor />));
    expect(screen.getByText("Cockpit widgets")).toBeTruthy();
    // The zone Select's visible label carries the widget name.
    expect(screen.getByText("Test Chip zone")).toBeTruthy();
    // The current default zone shows in the trigger.
    expect(screen.getByText("Top left")).toBeTruthy();
  });

  it("toggles a widget's visibility through setLoadoutWidget", () => {
    render(wrap(<CockpitLayoutEditor />));
    const hideBtn = screen.getByRole("switch", { name: "Hide Test Chip" });
    fireEvent.click(hideBtn);
    expect(
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout.widgets?.[
        "test.chip"
      ]?.hidden,
    ).toBe(true);
    // The control flips to the "show" affordance.
    expect(screen.getByRole("switch", { name: "Show Test Chip" })).toBeTruthy();
  });

  it("moves a widget to another zone through the Select", () => {
    render(wrap(<CockpitLayoutEditor />));
    // Open the zone Select and pick a new zone.
    fireEvent.click(screen.getByText("Top left"));
    fireEvent.click(screen.getByText("Bottom right"));
    expect(
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout.widgets?.[
        "test.chip"
      ]?.zone,
    ).toBe("bottom-right");
  });

  it("hides a built-in widget bound to a chrome flag through that flag", () => {
    for (const widget of BUILTIN_WIDGETS) {
      useCockpitWidgetRegistry.getState().register(widget);
    }
    const radar = BUILTIN_WIDGETS.find((w) => w.layoutKey === "proximityRadar");
    expect(radar).toBeDefined();
    render(wrap(<CockpitLayoutEditor />));
    fireEvent.click(screen.getByRole("switch", { name: `Hide ${radar!.title}` }));
    const layout =
      useSettingsStore.getState().loadouts[DEFAULT_LOADOUT_ID].layout;
    expect(layout.proximityRadar).toBe(false);
    expect(
      isCockpitWidgetVisible(radar!, { ...layout, density: "full" }),
    ).toBe(false);
    expect(
      screen.getByRole("switch", { name: `Show ${radar!.title}` }),
    ).toBeTruthy();
  });
});
