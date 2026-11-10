/**
 * @license GPL-3.0-only
 *
 * The tip layer draws the queue's tip beside its anchor, never over STOP,
 * the left column or the flight-state chip; "Got it", a tap on the tip and a
 * tap on the anchor dismiss it; an anchor that is not laid out reports as
 * not visible.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CockpitTipsUi } from "@/hooks/use-cockpit-tips";

const mocks = vi.hoisted(() => ({
  tip: null as { id: string; anchor: string; text: string } | null,
  dismiss: vi.fn(),
  ui: null as null | CockpitTipsUi,
}));

vi.mock("@/hooks/use-cockpit-tips", () => ({
  useCockpitTips: (_droneId: string, ui: CockpitTipsUi) => {
    mocks.ui = ui;
    return { tip: mocks.tip, dismiss: mocks.dismiss };
  },
}));

import { TipLayer } from "@/components/cockpit/TipLayer";
import { useInputStore } from "@/stores/input-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";
import { useSkillRegistry } from "@/lib/skills";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import type { Skill } from "@/lib/skills/types";

interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VIEW: R = { x: 0, y: 0, w: 1000, h: 600 };
const STOP: R = { x: 880, y: 0, w: 112, h: 120 };
const PILL: R = { x: 760, y: 8, w: 100, h: 40 };
const LEFT: R = { x: 0, y: 60, w: 120, h: 480 };
const CHIP: R = { x: 400, y: 8, w: 200, h: 40 };

function intersects(a: R, b: R): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const original = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  // Every element reports the box in its `data-rect`; the layer fills the view.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const raw = this.dataset.testid === "tip-layer" ? JSON.stringify(VIEW) : this.dataset.rect;
    const r: R = raw ? JSON.parse(raw) : { x: 0, y: 0, w: 0, h: 0 };
    return { x: r.x, y: r.y, left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h, toJSON: () => r } as DOMRect;
  };
  mocks.dismiss.mockReset();
  mocks.tip = null;
  mocks.ui = null;
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = original;
});

function renderScreen() {
  return render(
    <div>
      <button type="button" data-testid="cockpit-kill" data-rect={JSON.stringify(STOP)}>STOP</button>
      <div data-testid="status-pill" data-rect={JSON.stringify(PILL)}>pill</div>
      <div data-zone="left_column" data-rect={JSON.stringify(LEFT)} />
      <div data-testid="flight-state-chip" data-rect={JSON.stringify(CHIP)}>chip</div>
      <TipLayer droneId="drone-1" />
    </div>,
  );
}

function panelRect(): R {
  const el = screen.getByTestId("cockpit-tip");
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: 88 };
}

describe("TipLayer", () => {
  it("shows the store's tip next to its anchor", () => {
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "Warnings collect here. Tap to see them." };
    renderScreen();
    const el = screen.getByTestId("cockpit-tip");
    expect(el.textContent).toContain("Warnings collect here.");
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    const r = panelRect();
    // Left of the pill (the side with the most room: 760 px against 552
    // below), within a gap of it.
    expect(el.dataset.side).toBe("left");
    expect(r.x + r.w).toBeLessThanOrEqual(PILL.x);
    expect(PILL.x - (r.x + r.w)).toBeLessThanOrEqual(16);
  });

  it("never intersects STOP, the left column or the flight-state chip", () => {
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "tip" };
    renderScreen();
    const r = panelRect();
    expect(intersects(r, STOP)).toBe(false);
    expect(intersects(r, LEFT)).toBe(false);
    expect(intersects(r, CHIP)).toBe(false);
  });

  it("takes input only on the panel", () => {
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "tip" };
    renderScreen();
    expect(screen.getByTestId("tip-layer").style.pointerEvents).toBe("none");
    expect(screen.getByTestId("cockpit-tip").style.pointerEvents).toBe("auto");
  });

  it("Got it calls dismiss", () => {
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "tip" };
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
  });

  it("a tap on the anchor or a controller button dismisses", () => {
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "tip" };
    renderScreen();
    fireEvent.pointerDown(screen.getByTestId("status-pill"));
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    act(() => {
      useInputStore.setState({ buttons: [true] });
    });
    expect(mocks.dismiss).toHaveBeenCalledTimes(2);
    act(() => {
      useInputStore.setState({ buttons: [] });
    });
  });

  it("reports anchors that are not laid out as not visible", () => {
    renderScreen();
    expect(mocks.ui?.anchorsVisible.status_pill).toBe(true);
    expect(mocks.ui?.anchorsVisible.stop).toBe(true);
    expect(mocks.ui?.anchorsVisible.gimbal_pad).toBe(false);
    expect(mocks.ui?.anchorsVisible.skill_picker_chip).toBe(false);
    expect(mocks.ui?.sheetOrMenuOpen).toBe(false);
  });

  it("reports an alert banner from either part of the alert stack, and none when both are empty", () => {
    const { unmount } = render(
      <div>
        <div data-zone="alert_stack" data-rect={JSON.stringify({ x: 0, y: 0, w: 0, h: 0 })} />
        <div data-zone="alert_stack" data-rect={JSON.stringify({ x: 400, y: 60, w: 200, h: 30 })} />
        <TipLayer droneId="drone-1" />
      </div>,
    );
    expect(mocks.ui?.alertBannerVisible).toBe(true);
    unmount();
    render(
      <div>
        <div data-zone="alert_stack" data-rect={JSON.stringify({ x: 0, y: 0, w: 0, h: 0 })} />
        <TipLayer droneId="drone-1" />
      </div>,
    );
    expect(mocks.ui?.alertBannerVisible).toBe(false);
  });

  it("places a tip on a top-bar anchor below the top bar, never over it", () => {
    const BAR: R = { x: 0, y: 0, w: 1000, h: 56 };
    const BAR_STOP: R = { x: 880, y: 0, w: 112, h: 56 };
    mocks.tip = { id: "status_pill", anchor: "status_pill", text: "tip" };
    render(
      <div>
        <div data-zone="top_bar" data-rect={JSON.stringify(BAR)}>
          <button type="button" data-testid="cockpit-kill" data-rect={JSON.stringify(BAR_STOP)}>STOP</button>
          <div data-testid="status-pill" data-rect={JSON.stringify(PILL)}>pill</div>
          <div data-testid="flight-state-chip" data-rect={JSON.stringify(CHIP)}>chip</div>
        </div>
        <div data-zone="left_column" data-rect={JSON.stringify(LEFT)} />
        <TipLayer droneId="drone-1" />
      </div>,
    );
    const r = panelRect();
    expect(screen.getByTestId("cockpit-tip").dataset.side).toBe("bottom");
    expect(r.y).toBeGreaterThanOrEqual(BAR.y + BAR.h);
    expect(intersects(r, BAR)).toBe(false);
    expect(intersects(r, LEFT)).toBe(false);
  });

  it("counts the palette, the binding editor, quick settings, a skill confirm and the pill list as open sheets", () => {
    renderScreen();
    expect(mocks.ui?.sheetOrMenuOpen).toBe(false);
    const cases: [string, () => void, () => void][] = [
      ["palette", () => useSkillInputStore.setState({ paletteOpen: true }), () => useSkillInputStore.setState({ paletteOpen: false })],
      ["editor", () => useSkillInputStore.setState({ editorOpen: true }), () => useSkillInputStore.setState({ editorOpen: false })],
      ["quick settings", () => useFlyQuickSettingsStore.setState({ isOpen: true }), () => useFlyQuickSettingsStore.setState({ isOpen: false })],
      [
        "skill confirm",
        () => useSkillConfirmStore.setState({ pending: { id: 1, droneId: "drone-1", policy: {} as never, resolve: () => {} } }),
        () => useSkillConfirmStore.setState({ pending: null }),
      ],
      ["pill list", () => useFlightSheetStore.setState({ open: "status" }), () => useFlightSheetStore.setState({ open: null })],
    ];
    for (const [name, open, close] of cases) {
      act(open);
      expect(mocks.ui?.sheetOrMenuOpen, name).toBe(true);
      act(close);
      expect(mocks.ui?.sheetOrMenuOpen, name).toBe(false);
    }
  });

  it("counts only the skills the picker offers this vehicle class", () => {
    const pilot = parsePilotState(demoPilotWire({ vehicle_class: "multirotor" }));
    if (!pilot) throw new Error("demo pilot wire did not parse");
    useNavStreamStore.getState().setPilot("drone-1", pilot, Date.now());
    const skill = {
      id: "com.example.glide:glide",
      label: "Glide",
      icon: "Plane",
      category: "behavior",
      source: "plugin",
      pluginId: "com.example.glide",
      pickerCategory: "behavior",
      vehicleClasses: ["fixedwing"],
    } as unknown as Skill;
    const before = useSkillRegistry.getState().skills;
    useSkillRegistry.setState({ skills: new Map([[skill.id, skill]]) });
    try {
      renderScreen();
      expect(mocks.ui?.skillsAvailable).toBe(false);
    } finally {
      useSkillRegistry.setState({ skills: before });
      useNavStreamStore.getState().clear("drone-1");
    }
  });
});
