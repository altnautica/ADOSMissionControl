/**
 * @license GPL-3.0-only
 *
 * The right column's items: named with the spec's item ids, in the spec's
 * order, every control at least the spec's minimum touch target, spec text
 * for the labels, and a column too short for every item drops them in the
 * spec's `drop_order`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => ({ agentUrl: "http://agent.test", apiKey: "k" }),
}));

const shot = vi.fn<() => Promise<Blob | null>>();
vi.mock("@/lib/video/webrtc-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureScreenshot: () => shot(),
}));

const notify = vi.fn();
vi.mock("@/lib/skills/registry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifySkill: (...a: unknown[]) => notify(...a),
}));

vi.mock("@/hooks/use-ds4-dispatcher", () => ({ firePluginSkill: () => false }));

import { RightColumn, rightColumnItems, type RightItem } from "../RightColumn";
import { FlightGridContext } from "../flight-context";
import { flightGrid, type FlightGrid } from "../flight-grid";
import { useViewZoomStore } from "../view-zoom-store";

const zone = layoutSpec.zones.find((z) => z.id === "right_column") as unknown as {
  items: RightItem[];
  drop_order: RightItem[];
};
const base = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });

function withColumnHeight(h: number): FlightGrid {
  const rc = base.zones.right_column!;
  return { ...base, zones: { ...base.zones, right_column: { ...rc, h } } };
}

beforeEach(() => {
  shot.mockReset();
  notify.mockReset();
  useViewZoomStore.setState({ byDrone: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ available: true }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderColumn(grid: FlightGrid = base): Promise<HTMLElement> {
  const { container } = renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <RightColumn droneId="rc-drone" />
    </FlightGridContext.Provider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container.querySelector<HTMLElement>("[data-zone='right_column']")!;
}

describe("right column drop order", () => {
  it("drops items in the spec's drop_order as the column shrinks", () => {
    const dropped: RightItem[] = [];
    let shown = rightColumnItems(2000, 1, { gimbal: true });
    expect(shown).toEqual(zone.items);
    for (let h = 2000; h >= 0; h -= 2) {
      const next = rightColumnItems(h, 1, { gimbal: true });
      for (const it of shown) if (!next.includes(it)) dropped.push(it);
      shown = next;
    }
    expect(dropped).toEqual(zone.drop_order);
    // Items outside the drop order stay, in the spec's order.
    expect(shown).toEqual(zone.items.filter((it) => !zone.drop_order.includes(it)));
  });

  it("drops the same order in the rendered column", async () => {
    // The tallest column that no longer fits every item.
    let h = 2000;
    while (rightColumnItems(h, base.scale, { gimbal: true }).length === zone.items.length) h -= 1;
    const col = await renderColumn(withColumnHeight(h));
    const names = [...col.querySelectorAll("[data-item]")].map((el) => el.getAttribute("data-item"));
    expect(names).not.toContain(zone.drop_order[0]);
    expect(names).toContain(zone.drop_order[1]);
    expect(col.getAttribute("data-items")).toBe(zone.items.filter((it) => it !== zone.drop_order[0]).join(" "));
  });
});

describe("right column items", () => {
  it("names its items with the spec ids, in spec order", async () => {
    const col = await renderColumn();
    const names = [...col.querySelectorAll("[data-item]")].map((el) => el.getAttribute("data-item"));
    expect(names).toEqual(zone.items);
    for (const id of zone.items) expect(screen.getByTestId(`fs-${id}`)).not.toBeNull();
  });

  it("gives every control at least the minimum touch target", async () => {
    const col = await renderColumn();
    const min = layoutSpec.touch_target.min;
    const buttons = [...col.querySelectorAll<HTMLElement>("button")].filter((b) => b.dataset.testid !== "fs-gimbal-recentre");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons) {
      expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(min);
      expect(parseFloat(b.style.height)).toBeGreaterThanOrEqual(min);
    }
    const knob = screen.getByTestId("fs-gimbal-recentre");
    expect(parseFloat(knob.style.width)).toBeGreaterThanOrEqual(min);
  });

  it("labels the controls with the spec text", async () => {
    await renderColumn();
    expect(screen.getByTestId("fs-shutter").getAttribute("aria-label")).toBe("Take photo");
    expect(screen.getByTestId("fs-photo_video_switch").getAttribute("aria-label")).toBe("Shutter mode");
    expect(screen.getByTestId("fs-camera_settings").getAttribute("aria-label")).toBe("Camera settings");
    const zoom = screen.getByTestId("fs-zoom");
    expect(zoom.getAttribute("aria-label")).toBe("Digital ×1");
    fireEvent.click(zoom);
    expect(zoom.getAttribute("aria-label")).toBe("Digital ×2");
  });

  it("toasts a saved photo, and no video when there is no picture", async () => {
    await renderColumn();
    shot.mockResolvedValueOnce(new Blob(["x"]));
    await act(async () => {
      fireEvent.click(screen.getByTestId("fs-shutter"));
    });
    expect(notify).toHaveBeenLastCalledWith("Photo saved", "success");
    shot.mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.click(screen.getByTestId("fs-shutter"));
    });
    expect(notify).toHaveBeenLastCalledWith("No video", "warning");
  });
});
