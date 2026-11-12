/**
 * Render tests for the planner tool rail: every tool is reachable within two
 * clicks, split buttons follow the active tool, the pattern gallery points the
 * inspector at the pattern editor, and the help popover renders the shared
 * shortcut table.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { PlannerTool } from "@/lib/types";
import type { PatternResult } from "@/lib/patterns/types";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { MapToolbar } from "@/components/planner/MapToolbar";
import { PLANNER_SHORTCUTS } from "@/lib/planner-shortcuts";
import { usePlannerStore } from "@/stores/planner-store";
import { usePatternStore } from "@/stores/pattern-store";

const ALL_TOOLS = PLANNER_SHORTCUTS.flatMap((s) => (s.tool ? [s.tool] : []));

function renderRail(activeTool: PlannerTool = "select") {
  const onToolChange = vi.fn();
  const utils = render(
    <MapToolbar
      activeTool={activeTool}
      onToolChange={onToolChange}
      canUndo
      canRedo
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onToggleOverlays={vi.fn()}
      onToggleDownload={vi.fn()}
    />,
  );
  return { onToolChange, ...utils };
}

describe("MapToolbar rail", () => {
  beforeEach(() => {
    usePatternStore.setState({ activePatternType: null });
    usePlannerStore.setState({ inspectorOpen: false, inspectorTarget: { kind: "mission" } });
  });

  it("reaches every planner tool within two clicks", () => {
    const { onToolChange } = renderRail();
    const rail = screen.getByRole("toolbar");

    // One click: every tool shown directly on the rail.
    for (const el of rail.querySelectorAll<HTMLButtonElement>("button[data-tool]")) fireEvent.click(el);

    // Two clicks: open each split flyout, pick each listed tool.
    for (const group of ["rail.waypointTools", "rail.drawTools", "rail.markerTools"]) {
      const chevron = within(rail).getByRole("button", { name: group });
      fireEvent.click(chevron);
      const flyout = screen.getByRole("dialog", { name: group });
      const items = flyout.querySelectorAll<HTMLButtonElement>("button[data-tool]");
      for (let i = 0; i < items.length; i++) {
        // Each pick closes the flyout, so reopen before the next one.
        if (i > 0) fireEvent.click(chevron);
        const fresh = screen.getByRole("dialog", { name: group }).querySelectorAll<HTMLButtonElement>("button[data-tool]")[i];
        fireEvent.click(fresh);
      }
    }

    const reached = new Set(onToolChange.mock.calls.map(([tool]) => tool));
    for (const tool of ALL_TOOLS) expect(reached, tool).toContain(tool);
  });

  it("has no clear-all control", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /clearAll/ })).toBeNull();
  });

  it("puts the active tool on its split button face with the accent", () => {
    const { rerender, onToolChange } = renderRail("land");
    const face = screen.getByRole("toolbar").querySelector<HTMLButtonElement>('button[data-tool="land"]');
    expect(face).not.toBeNull();
    expect(face!.getAttribute("aria-pressed")).toBe("true");
    expect(face!.className).toContain("text-accent-primary");

    // Switching to another group keeps "land" as the last-used face.
    rerender(
      <MapToolbar activeTool="polygon" onToolChange={onToolChange} canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} />,
    );
    const kept = screen.getByRole("toolbar").querySelector<HTMLButtonElement>('button[data-tool="land"]');
    expect(kept!.className).toContain("text-text-secondary");
    fireEvent.click(kept!);
    expect(onToolChange).toHaveBeenCalledWith("land");
  });

  it("picking a gallery pattern activates it and opens the pattern inspector", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "rail.patterns (G)" }));
    const gallery = screen.getByRole("dialog", { name: "rail.gallery.ariaLabel" });
    fireEvent.click(gallery.querySelector('button[data-pattern="orbit"]')!);

    expect(usePatternStore.getState().activePatternType).toBe("orbit");
    const planner = usePlannerStore.getState();
    expect(planner.inspectorTarget).toEqual({ kind: "pattern" });
    expect(planner.inspectorOpen).toBe(true);
    expect(screen.queryByRole("dialog", { name: "rail.gallery.ariaLabel" })).toBeNull();
  });

  it("re-picking the active pattern keeps the generated result", () => {
    const result = { waypoints: [] } as unknown as PatternResult;
    usePatternStore.setState({ activePatternType: "orbit", patternResult: result });
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "rail.patterns (G)" }));
    const gallery = screen.getByRole("dialog", { name: "rail.gallery.ariaLabel" });
    fireEvent.click(gallery.querySelector('button[data-pattern="orbit"]')!);

    expect(usePatternStore.getState().activePatternType).toBe("orbit");
    expect(usePatternStore.getState().patternResult).toBe(result);
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "pattern" });
  });

  it("help popover renders every shortcut from the shared table", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "rail.help.title" }));
    const help = screen.getByRole("dialog", { name: "rail.help.title" });
    for (const s of PLANNER_SHORTCUTS.filter((x) => !x.desktopOnly)) {
      expect(within(help).getAllByText(s.labelKey).length).toBeGreaterThan(0);
    }
  });

  it("keeps an unavailable offline-area button focusable, inert and explained", () => {
    const onToggleDownload = vi.fn();
    render(
      <MapToolbar
        activeTool="select"
        onToolChange={vi.fn()}
        canUndo
        canRedo
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onToggleDownload={onToggleDownload}
        downloadDisabled
      />,
    );
    const button = screen.getByRole("button", { name: "offline.waitingForMap" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(onToggleDownload).not.toHaveBeenCalled();

    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("offline.waitingForMap");
  });
});

describe("MapToolbar tool-group hit targets", () => {
  it("draws each group opener as a 16 × 32 strip with a 48 × 48 hit area", () => {
    renderRail();
    for (const group of ["rail.waypointTools", "rail.drawTools", "rail.markerTools"]) {
      const opener = screen.getByRole("button", { name: group });
      // h-8 = 32 px tall, w-4 = 16 px wide; the ::after box adds 8 px above
      // and below (48 px) and 32 px to the right (48 px).
      expect(opener.className).toMatch(/(^|\s)h-8(\s|$)/);
      expect(opener.className).toMatch(/(^|\s)w-4(\s|$)/);
      expect(opener.className).toContain("after:-inset-y-2");
      expect(opener.className).toContain("after:-right-8");
    }
  });

  it("opens a group's flyout from a right-click on its face", () => {
    renderRail();
    const face = screen.getByRole("toolbar").querySelector<HTMLButtonElement>('button[data-tool="waypoint"]')!;
    fireEvent.contextMenu(face);
    expect(screen.getByRole("dialog", { name: "rail.waypointTools" })).toBeInTheDocument();
  });
});
