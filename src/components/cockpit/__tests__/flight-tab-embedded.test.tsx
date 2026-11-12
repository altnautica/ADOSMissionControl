/**
 * @license GPL-3.0-only
 *
 * The cockpit embedded in the drone's Flight tab: the top bar's Full screen
 * button takes it full screen (fixed, `data-immersive`) and back; a bound
 * skill key pressed with focus in the fleet list sends nothing; and the toast
 * anchor counts the frame's own offset beside the fleet sidebar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type * as Skills from "@/lib/skills";

const { activateSpy } = vi.hoisted(() => ({
  activateSpy: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));
vi.mock("@/lib/skills", async () => {
  const actual = await vi.importActual<typeof Skills>("@/lib/skills");
  return { ...actual, activateBound: activateSpy };
});
vi.mock("@/components/ui/toast", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/toast")>()),
  useToast: () => ({ toast: vi.fn() }),
}));

import messages from "../../../../locales/en.json";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { cockpitOwnsKeyboard } from "@/hooks/use-cockpit-input";
import { useSkillInput } from "@/hooks/use-skill-input";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useUiStore } from "@/stores/ui-store";
import { DEFAULT_LOADOUT_ID, cloneDefaultLoadout } from "@/stores/settings/keybindings-slice";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUiStore.setState({ immersiveMode: false });
  document.documentElement.style.removeProperty("--fs-toast-left");
  activateSpy.mockClear();
});

describe("the Full screen button", () => {
  it("toggles immersive mode and the fixed frame", () => {
    renderWithIntl(<CockpitView droneId="embedded-drone" />);
    const frame = screen.getByTestId("flight-screen");
    expect(frame.className).toContain("relative");
    expect(frame.className).not.toContain("fixed");
    fireEvent.click(screen.getByTestId("fs-fullscreen"));
    expect(useUiStore.getState().immersiveMode).toBe(true);
    expect(screen.getByTestId("flight-screen").className).toContain("fixed");
    expect(screen.getByTestId("flight-screen").hasAttribute("data-immersive")).toBe(true);
    fireEvent.click(screen.getByTestId("fs-fullscreen"));
    expect(useUiStore.getState().immersiveMode).toBe(false);
    expect(screen.getByTestId("flight-screen").className).not.toContain("fixed");
  });
});

describe("the toast anchor beside the fleet sidebar", () => {
  it("adds the frame's 288 px left offset", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 288, top: 0, right: 1280, bottom: 800, width: 992, height: 800, x: 288, y: 0, toJSON: () => ({}) });
    renderWithIntl(<CockpitView droneId="embedded-drone" />);
    const left = parseFloat(document.documentElement.style.getPropertyValue("--fs-toast-left"));
    expect(left).toBeGreaterThanOrEqual(288);
    rect.mockRestore();
  });
});

describe("cockpit keys while embedded", () => {
  let release: () => void = () => {};
  beforeEach(() => {
    useDroneManager.setState({ selectedDroneId: "embedded-drone" });
    useSettingsStore.setState({ loadouts: { [DEFAULT_LOADOUT_ID]: cloneDefaultLoadout() }, activeLoadoutId: DEFAULT_LOADOUT_ID });
    release = useSkillInputStore.getState().acquireSurface();
  });
  afterEach(() => {
    release();
    useDroneManager.setState({ selectedDroneId: null });
  });

  function Dispatcher() {
    useSkillInput();
    return null;
  }

  function takeoffKey(): string {
    const slot = cloneDefaultLoadout().slots.find((s) => s.skillId === "takeoff" && s.key);
    if (!slot?.key) throw new Error("the default loadout binds no take-off key");
    return slot.key;
  }

  it("send nothing with focus in the fleet list", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <aside data-testid="fleet">
          <input aria-label="Search fleet" />
          <button type="button">Alpha-01</button>
        </aside>
        <Dispatcher />
      </NextIntlClientProvider>,
    );
    const key = takeoffKey();
    const search = screen.getByLabelText("Search fleet");
    search.focus();
    fireEvent.keyDown(search, { key });
    const row = screen.getByText("Alpha-01");
    row.focus();
    expect(cockpitOwnsKeyboard()).toBe(false);
    fireEvent.keyDown(row, { key });
    expect(activateSpy).not.toHaveBeenCalled();
  });

  it("belong to the cockpit with focus inside it or nowhere, and always in full screen", () => {
    const frame = document.createElement("div");
    frame.className = "ados-cockpit flight-screen";
    const inner = document.createElement("button");
    frame.append(inner);
    const outside = document.createElement("button");
    document.body.append(frame, outside);
    inner.focus();
    expect(cockpitOwnsKeyboard()).toBe(true);
    (document.activeElement as HTMLElement).blur();
    expect(cockpitOwnsKeyboard()).toBe(true);
    outside.focus();
    expect(cockpitOwnsKeyboard()).toBe(false);
    useUiStore.setState({ immersiveMode: true });
    expect(cockpitOwnsKeyboard()).toBe(true);
    frame.remove();
    outside.remove();
  });
});
