/**
 * @license GPL-3.0-only
 *
 * The cockpit's on-demand sheets (quick settings, the command palette, the
 * skill-bar editor) load their chunk the first time the pilot opens one. In
 * the node panel the cockpit sits inside the tab body's Suspense boundary; a
 * sheet without a boundary of its own suspends into that one, and React hides
 * the whole cockpit (video and HUD) behind the tab fallback until the chunk
 * arrives. Each sheet must hold its own load, so the cockpit stays on screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { act, cleanup, screen } from "@testing-library/react";

// One held chunk per sheet, released at the end of its case.
const held = vi.hoisted(() => ({
  quick: Promise.withResolvers<void>(),
  palette: Promise.withResolvers<void>(),
  editor: Promise.withResolvers<void>(),
}));

// What the app build resolves next/dynamic to: React.lazy, no boundary of its
// own without `loading`.
vi.mock("next/dynamic", async () =>
  (await import("../../../../tests/helpers/app-dynamic")).appDynamicModule(),
);
vi.mock("@/components/cockpit/CockpitQuickSettings", async () => {
  await held.quick.promise;
  return { CockpitQuickSettings: () => <div>quick-sheet</div> };
});
vi.mock("@/components/cockpit/CockpitCommandPalette", async () => {
  await held.palette.promise;
  return { CockpitCommandPalette: () => <div>palette-sheet</div> };
});
vi.mock("@/components/cockpit/SkillBarEditor", async () => {
  await held.editor.promise;
  return { SkillBarEditor: () => <div>editor-sheet</div> };
});

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useSkillInputStore } from "@/stores/skill-input-store";

afterEach(() => {
  cleanup();
  useFlyQuickSettingsStore.getState().close();
  useSkillInputStore.setState({ paletteOpen: false, editorOpen: false });
});

const SHEETS = [
  { name: "quick settings", chunk: held.quick, text: "quick-sheet", open: () => useFlyQuickSettingsStore.getState().open() },
  { name: "command palette", chunk: held.palette, text: "palette-sheet", open: () => useSkillInputStore.setState({ paletteOpen: true }) },
  { name: "skill-bar editor", chunk: held.editor, text: "editor-sheet", open: () => useSkillInputStore.setState({ editorOpen: true }) },
];

describe("cockpit sheets load without hiding the cockpit", () => {
  it.each(SHEETS)("keeps the cockpit on screen while the $name chunk loads", async (sheet) => {
    useCockpitStore.getState().setEnabled(true);
    // The tab body's boundary, as the node panel wraps every surface.
    renderWithIntl(
      <Suspense fallback={<div data-testid="tab-fallback" />}>
        <CockpitView droneId="sheet-drone" />
      </Suspense>,
    );
    const frame = await screen.findByTestId("flight-screen", {}, { timeout: 10_000 });

    act(() => sheet.open());
    expect(screen.queryByTestId("tab-fallback")).toBeNull();
    expect(frame.isConnected).toBe(true);
    // React hides a suspended boundary's content with an inline display:none.
    expect(frame.closest('[style*="display: none"]')).toBeNull();

    await act(async () => {
      sheet.chunk.resolve();
    });
    expect(await screen.findByText(sheet.text)).toBeTruthy();
    expect(frame.closest('[style*="display: none"]')).toBeNull();
  });
});
