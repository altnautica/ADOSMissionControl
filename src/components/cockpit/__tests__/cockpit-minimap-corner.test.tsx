/**
 * @license GPL-3.0-only
 *
 * The flight-screen map card's corner buttons: the expand button puts the
 * cockpit on its Map view (it no longer leaves for another tab), and both
 * 24 px buttons carry a 48 px hit area, the expand button's grown only away
 * from the frame toggle on its left.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("@/components/map/local/use-minimap-frame", () => ({
  useMinimapFrame: () => ({ frame: "global", pin: "auto", setPin: () => {} }),
}));

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CockpitMinimap } from "../CockpitMinimap";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { useUiStore } from "@/stores/ui-store";
import messages from "../../../../locales/en.json";

const CSS = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

/** The `::after` hit box of a corner button in px relative to its left edge,
 *  cascading the card's hit-area rules in file order for its classes. */
function hitBox(classes: string[], buttonPx: number): { left: number; right: number; height: number } {
  const decls: Record<string, string> = {};
  for (const m of CSS.matchAll(/\.ados-cockpit \.mmap \.([\w-]+)::after \{([^}]*)\}/g)) {
    if (!classes.includes(m[1])) continue;
    for (const d of m[2].split(";")) {
      const [k, v] = d.split(":").map((x) => x?.trim());
      if (k && v) decls[k] = v;
    }
  }
  const px = (v: string) => (v.endsWith("%") ? (parseFloat(v) / 100) * buttonPx : parseFloat(v));
  const marginLeft = px((decls.margin ?? "0 0 0 0").split(/\s+/)[3] ?? "0");
  const left = px(decls.left) + marginLeft;
  return { left, right: left + px(decls.width), height: px(decls.height) };
}

const DRONE = "node:minimap-corner";

afterEach(() => {
  cleanup();
  useCockpitViewStore.setState({ byDrone: {}, splitByDrone: {} });
});

describe("cockpit minimap corner buttons", () => {
  it("switches this drone's cockpit to the Map view", () => {
    const pending = useUiStore.getState().pendingDetailTab;
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    const open = screen.getByTestId("minimap-open-map");
    expect(open.getAttribute("title")).toBe(messages.cockpit.openMapView);
    fireEvent.click(open);
    expect(useCockpitViewStore.getState().byDrone[DRONE]).toBe("map");
    expect(useUiStore.getState().pendingDetailTab).toBe(pending);
  });

  it("gives both 24 px buttons a 48 px hit area", () => {
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    for (const id of ["minimap-open-map", "minimap-layers"]) {
      expect(screen.getByTestId(id).classList.contains("mmap-hit")).toBe(true);
    }
    const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
    const rule = css.match(/\.mmap \.mmap-hit::after \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("width: 48px");
    expect(rule).toContain("height: 48px");
  });

  it("keeps the expand button's hit area off the frame toggle beside it", () => {
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    const open = screen.getByTestId("minimap-open-map");
    // The toggle is the button's left neighbour, 4 px away (gap-1).
    expect(open.previousElementSibling?.getAttribute("role")).toBe("group");
    expect(open.parentElement?.className).toContain("gap-1");
    const box = hitBox([...open.classList], 24);
    expect(box.left).toBeGreaterThan(-4);
    expect(box.right - box.left).toBeGreaterThanOrEqual(36);
    expect(box.height).toBe(48);
    // The layer button has no neighbour on its left and keeps the full 48 px.
    const layers = hitBox([...screen.getByTestId("minimap-layers").classList], 24);
    expect(layers.right - layers.left).toBe(48);
  });
});
