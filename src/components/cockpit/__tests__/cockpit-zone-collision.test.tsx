/**
 * @module cockpit/cockpit-zone-collision.test
 * @description The bottom corners had two placement systems at one address.
 *
 * The telemetry strip and the proximity radar anchored themselves with
 * `.zone.bl` / `.zone.br`, at exactly the coordinates and z-index of the
 * arrangeable-widget containers `.cockpit-zone.bl` / `.cockpit-zone.br`. An
 * operator who moved a widget into that corner got an overlap with paint
 * order — DOM order, which they do not control — deciding what they saw.
 *
 * Both are registry widgets now, so a corner is one flex column and its
 * occupants stack. This pins that, and pins the density gate that moved out of
 * the stylesheet with them: a widget composed into a shared container has no
 * wrapper of its own to carry a `.d-std` / `.d-full` class.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { BUILTIN_WIDGETS, CockpitZones } from "@/components/cockpit/CockpitZones";
import { useCockpitWidgetRegistry } from "@/lib/cockpit/widget-registry";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { CockpitLayout } from "@/stores/settings/keybindings-slice";
import type { CockpitDensity } from "@/lib/cockpit/density";

function layout(over: Partial<CockpitLayout> = {}): CockpitLayout {
  return {
    topBar: true,
    minimap: true,
    telemetryStrip: true,
    proximityRadar: true,
    density: "full",
    ...over,
  };
}

function clearRegistry(): void {
  const { items, unregister } = useCockpitWidgetRegistry.getState();
  for (const id of [...items.keys()]) unregister(id);
}

/**
 * Register the real built-in definitions. `registerBuiltinCockpitWidgets` is
 * module-guarded, so it cannot repopulate a cleared registry; registering
 * `BUILTIN_WIDGETS` directly keeps the assertions pointed at the shipped
 * definitions rather than at a copy that could drift.
 */
function registerBuiltins(): void {
  const { register } = useCockpitWidgetRegistry.getState();
  for (const w of BUILTIN_WIDGETS) register(w);
  seedObstacles();
}

/**
 * The radar renders nothing without obstacle telemetry, which is correct — an
 * empty radar would be a fabricated "all clear". Seed a fresh sweep so the
 * placement assertions below have a radar to find.
 */
function seedObstacles(): void {
  useTelemetryStore.getState().pushObstacle({
    timestamp: Date.now(),
    distances: Array.from({ length: 72 }, (_, i) => 400 + i * 5),
    minDistance: 20,
    maxDistance: 4000,
    increment: 5,
    incrementF: 5,
    angleOffset: 0,
    frame: 12,
  });
}

function renderZones(l: CockpitLayout) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitZones droneId="d" layout={l} />
    </NextIntlClientProvider>,
  );
}

describe("cockpit bottom-corner placement", () => {
  beforeEach(clearRegistry);
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("puts the telemetry strip inside the bottom-left zone container", () => {
    registerBuiltins();
    const { container } = renderZones(layout());

    const bl = container.querySelector(".cockpit-zone.bl");
    expect(bl).not.toBeNull();
    expect(bl?.querySelector(".telem")).not.toBeNull();

    // The self-anchoring wrapper is gone: no `.zone.bl` competing for the
    // same corner.
    expect(container.querySelector(".zone.bl")).toBeNull();
  });

  it("puts the proximity radar inside the bottom-right zone container", () => {
    registerBuiltins();
    const { container } = renderZones(layout());

    const br = container.querySelector(".cockpit-zone.br");
    expect(br).not.toBeNull();
    expect(br?.querySelector(".radar")).not.toBeNull();
    expect(container.querySelector(".zone.br")).toBeNull();
  });

  it("stacks an operator widget with the strip instead of covering it", () => {
    registerBuiltins();
    useCockpitWidgetRegistry.getState().register({
      id: "op.widget",
      zone: "bottom-left",
      source: "plugin",
      arrangeable: true,
      order: 99,
      render: () => <span data-testid="op">op</span>,
    });

    const { container } = renderZones(layout());
    const columns = container.querySelectorAll(".cockpit-zone.bl");

    // One column for the corner, not two overlapping ones.
    expect(columns).toHaveLength(1);
    const bl = columns[0];
    expect(bl.querySelector(".telem")).not.toBeNull();
    expect(bl.querySelector('[data-testid="op"]')).not.toBeNull();
  });

  describe("density gating moved into the registry", () => {
    const cases: Array<[CockpitDensity, boolean, boolean]> = [
      // density,   strip visible (needs full), radar visible (needs standard)
      ["minimal", false, false],
      ["standard", false, true],
      ["full", true, true],
    ];

    it.each(cases)("at %s density: strip=%s radar=%s", (density, strip, radar) => {
      registerBuiltins();
      const { container } = renderZones(layout({ density }));
      expect(Boolean(container.querySelector(".telem")), "strip").toBe(strip);
      expect(Boolean(container.querySelector(".radar")), "radar").toBe(radar);
    });
  });

  it("still honours the operator's own visibility toggles at full density", () => {
    registerBuiltins();
    const { container } = renderZones(
      layout({ telemetryStrip: false, proximityRadar: false }),
    );
    expect(container.querySelector(".telem")).toBeNull();
    expect(container.querySelector(".radar")).toBeNull();
  });

  it("lets the operator move the strip to another corner", () => {
    registerBuiltins();
    const { container } = renderZones({
      ...layout(),
      widgets: { "builtin.telemetry-strip": { zone: "top-right" } },
    });
    expect(container.querySelector(".cockpit-zone.tr .telem")).not.toBeNull();
    expect(container.querySelector(".cockpit-zone.bl .telem")).toBeNull();
  });
});
