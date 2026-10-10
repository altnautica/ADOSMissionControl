import { beforeEach, describe, expect, it } from "vitest";

import type { CockpitLayout } from "@/stores/settings/keybindings-slice";
import {
  effectiveWidgetZone,
  isCockpitWidgetEnabled,
  isCockpitWidgetVisible,
  registerCockpitWidget,
  unregisterCockpitWidget,
  useCockpitWidgetRegistry,
  widgetMeetsDensity,
  type CockpitWidget,
} from "@/lib/cockpit/widget-registry";

function widget(over: Partial<CockpitWidget> & { id: string }): CockpitWidget {
  return {
    zone: "bottom-right",
    source: "builtin",
    render: () => null,
    ...over,
  };
}

const LAYOUT: CockpitLayout = {
  topBar: true,
  minimap: true,
  telemetryStrip: false,
  proximityRadar: true,
  density: "standard",
};

describe("cockpit widget registry", () => {
  beforeEach(() => {
    // Clear the singleton registry between tests.
    const { items, unregister } = useCockpitWidgetRegistry.getState();
    for (const id of [...items.keys()]) unregister(id);
  });

  it("registers and resolves widgets in order", () => {
    const { register, resolve } = useCockpitWidgetRegistry.getState();
    register(widget({ id: "b", order: 20 }));
    register(widget({ id: "a", order: 10 }));
    register(widget({ id: "c" })); // unordered -> after the ordered ones
    expect(resolve().map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("a built-in and a plugin widget share one registry and one shape", () => {
    const { register, resolve } = useCockpitWidgetRegistry.getState();
    register(widget({ id: "builtin.radar", source: "builtin", order: 1 }));
    register(widget({ id: "plugin:thermal", source: "plugin", order: 2 }));
    const ids = resolve().map((w) => w.id);
    expect(ids).toEqual(["builtin.radar", "plugin:thermal"]);
  });

  it("unregister removes a widget", () => {
    const { register, unregister, resolve } = useCockpitWidgetRegistry.getState();
    register(widget({ id: "x" }));
    expect(resolve()).toHaveLength(1);
    unregister("x");
    expect(resolve()).toHaveLength(0);
  });

  it("the source-agnostic register/unregister helpers hit the same registry", () => {
    registerCockpitWidget(widget({ id: "plugin:p", source: "plugin" }));
    expect(useCockpitWidgetRegistry.getState().resolve()).toHaveLength(1);
    unregisterCockpitWidget("plugin:p");
    expect(useCockpitWidgetRegistry.getState().resolve()).toHaveLength(0);
  });
});

describe("effectiveWidgetZone", () => {
  it("uses the per-loadout override for an arrangeable widget", () => {
    const w = widget({ id: "chip", zone: "top-left", arrangeable: true });
    const layout: CockpitLayout = {
      ...LAYOUT,
      widgets: { chip: { zone: "bottom-right" } },
    };
    expect(effectiveWidgetZone(w, layout)).toBe("bottom-right");
  });

  it("falls back to the default zone when there is no override", () => {
    const w = widget({ id: "chip", zone: "top-left", arrangeable: true });
    expect(effectiveWidgetZone(w, LAYOUT)).toBe("top-left");
  });

  it("ignores an override on a non-arrangeable widget", () => {
    const w = widget({ id: "hud", zone: "center", arrangeable: false });
    const layout: CockpitLayout = {
      ...LAYOUT,
      widgets: { hud: { zone: "bottom-right" } },
    };
    expect(effectiveWidgetZone(w, layout)).toBe("center");
  });
});

describe("isCockpitWidgetVisible", () => {
  it("follows the mapped CockpitLayout flag", () => {
    expect(
      isCockpitWidgetVisible(
        widget({ id: "r", layoutKey: "proximityRadar" }),
        LAYOUT,
      ),
    ).toBe(true);
    expect(
      isCockpitWidgetVisible(
        widget({ id: "t", layoutKey: "telemetryStrip" }),
        LAYOUT,
      ),
    ).toBe(false);
  });

  it("falls back to defaultVisible when unmapped (default true)", () => {
    expect(isCockpitWidgetVisible(widget({ id: "a" }), LAYOUT)).toBe(true);
    expect(
      isCockpitWidgetVisible(widget({ id: "b", defaultVisible: false }), LAYOUT),
    ).toBe(false);
  });

  it("a per-widget hidden override wins for a widget with no layoutKey", () => {
    const w = widget({ id: "chip", arrangeable: true });
    expect(
      isCockpitWidgetVisible(w, { ...LAYOUT, widgets: { chip: { hidden: true } } }),
    ).toBe(false);
    expect(
      isCockpitWidgetVisible(w, {
        ...LAYOUT,
        widgets: { chip: { hidden: false } },
      }),
    ).toBe(true);
  });

  it("a chrome-flag widget still follows its layoutKey, not a per-widget override", () => {
    // telemetryStrip is off in LAYOUT; a stray per-widget entry must not win.
    const w = widget({ id: "builtin.telemetry-strip", layoutKey: "telemetryStrip" });
    expect(
      isCockpitWidgetVisible(w, {
        ...LAYOUT,
        widgets: { "builtin.telemetry-strip": { hidden: false } },
      }),
    ).toBe(false);
  });
});

describe("density and the layout toggle are separate gates", () => {
  it("density is decided by minDensity alone", () => {
    const w = widget({ id: "card", minDensity: "full" });
    expect(widgetMeetsDensity(w, "standard")).toBe(false);
    expect(widgetMeetsDensity(w, "full")).toBe(true);
    expect(widgetMeetsDensity(widget({ id: "any" }), "minimal")).toBe(true);
  });

  it("the toggle only shows or hides, whatever the density", () => {
    const w = widget({ id: "radar", layoutKey: "proximityRadar", minDensity: "full" });
    // On in the layout, thinned out at standard: enabled, not visible.
    expect(isCockpitWidgetEnabled(w, LAYOUT)).toBe(true);
    expect(isCockpitWidgetVisible(w, LAYOUT)).toBe(false);
    expect(isCockpitWidgetVisible(w, { ...LAYOUT, density: "full" })).toBe(true);
    // Off in the layout: hidden at every density.
    const off = { ...LAYOUT, proximityRadar: false, density: "full" as const };
    expect(isCockpitWidgetEnabled(w, off)).toBe(false);
    expect(isCockpitWidgetVisible(w, off)).toBe(false);
  });
});
