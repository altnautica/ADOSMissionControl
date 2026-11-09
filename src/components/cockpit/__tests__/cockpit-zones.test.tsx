/**
 * CockpitZones placement: an arrangeable widget lands inside the anchored
 * container for its effective zone (honouring a per-loadout override), a
 * non-arrangeable fixture renders bare, and a hidden widget renders nothing.
 * Built-in == plugin: a plugin-sourced arrangeable widget is placed the same
 * way as a built-in.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CockpitZones } from "@/components/cockpit/CockpitZones";
import { useCockpitWidgetRegistry } from "@/lib/cockpit/widget-registry";
import type { CockpitLayout } from "@/stores/settings/keybindings-slice";

const LAYOUT: CockpitLayout = {
  density: "standard",
};

function clearRegistry(): void {
  const { items, unregister } = useCockpitWidgetRegistry.getState();
  for (const id of [...items.keys()]) unregister(id);
}

describe("CockpitZones", () => {
  beforeEach(clearRegistry);
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("places an arrangeable widget in its default-zone container", () => {
    useCockpitWidgetRegistry.getState().register({
      id: "chip",
      zone: "top-left",
      source: "builtin",
      arrangeable: true,
      render: () => <span data-testid="chip">chip</span>,
    });
    const { container } = render(<CockpitZones droneId="d" layout={LAYOUT} />);
    const zone = container.querySelector(".cockpit-zone.tl");
    expect(zone).not.toBeNull();
    expect(zone?.querySelector('[data-testid="chip"]')).not.toBeNull();
  });

  it("honours a per-loadout zone override", () => {
    useCockpitWidgetRegistry.getState().register({
      id: "chip",
      zone: "top-left",
      source: "builtin",
      arrangeable: true,
      render: () => <span data-testid="chip">chip</span>,
    });
    const { container } = render(
      <CockpitZones
        droneId="d"
        layout={{ ...LAYOUT, widgets: { chip: { zone: "bottom-right" } } }}
      />,
    );
    expect(container.querySelector(".cockpit-zone.tl")).toBeNull();
    const zone = container.querySelector(".cockpit-zone.br");
    expect(zone?.querySelector('[data-testid="chip"]')).not.toBeNull();
  });

  it("renders a non-arrangeable fixture bare (no zone container)", () => {
    useCockpitWidgetRegistry.getState().register({
      id: "hud",
      zone: "center",
      source: "builtin",
      render: () => <span data-testid="hud">hud</span>,
    });
    const { container, queryByTestId } = render(
      <CockpitZones droneId="d" layout={LAYOUT} />,
    );
    expect(queryByTestId("hud")).not.toBeNull();
    expect(container.querySelector(".cockpit-zone")).toBeNull();
  });

  it("does not render a widget hidden by a per-widget override", () => {
    useCockpitWidgetRegistry.getState().register({
      id: "chip",
      zone: "top-left",
      source: "builtin",
      arrangeable: true,
      render: () => <span data-testid="chip">chip</span>,
    });
    const { queryByTestId } = render(
      <CockpitZones
        droneId="d"
        layout={{ ...LAYOUT, widgets: { chip: { hidden: true } } }}
      />,
    );
    expect(queryByTestId("chip")).toBeNull();
  });

  it("places a plugin-sourced arrangeable widget the same way as a built-in", () => {
    useCockpitWidgetRegistry.getState().register({
      id: "plugin:thermal",
      zone: "bottom-center",
      source: "plugin",
      arrangeable: true,
      render: () => <span data-testid="plugin">plugin</span>,
    });
    const { container } = render(<CockpitZones droneId="d" layout={LAYOUT} />);
    const zone = container.querySelector(".cockpit-zone.bc");
    expect(zone?.querySelector('[data-testid="plugin"]')).not.toBeNull();
  });

  it("stacks two widgets that share a zone in one container", () => {
    const reg = useCockpitWidgetRegistry.getState();
    reg.register({
      id: "a",
      zone: "top-left",
      source: "builtin",
      arrangeable: true,
      order: 1,
      render: () => <span data-testid="a">a</span>,
    });
    reg.register({
      id: "b",
      zone: "top-left",
      source: "plugin",
      arrangeable: true,
      order: 2,
      render: () => <span data-testid="b">b</span>,
    });
    const { container } = render(<CockpitZones droneId="d" layout={LAYOUT} />);
    const zones = container.querySelectorAll(".cockpit-zone.tl");
    expect(zones).toHaveLength(1);
    expect(zones[0].querySelectorAll("span")).toHaveLength(2);
  });
});
