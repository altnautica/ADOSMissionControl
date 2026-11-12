/**
 * On a narrow screen the top bar's routes and links live in one menu button,
 * and the palette entry there (like the top bar's chord hint) opens the
 * palette. The chord reads Ctrl K off macOS.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));

import { ShellCompactMenu } from "../ShellCompactMenu";
import { OPEN_COMMAND_PALETTE_EVENT, usePaletteChordLabel } from "@/lib/command-palette-open";

function renderMenu() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShellCompactMenu />
    </NextIntlClientProvider>,
  );
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: messages.shell.menu }));
  });
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("ShellCompactMenu", () => {
  it("lists every top-level route and navigates", () => {
    renderMenu();
    for (const key of ["dashboard", "plan", "simulate", "history", "mcp"] as const) {
      expect(screen.getByRole("menuitem", { name: messages.nav[key] })).toBeTruthy();
    }
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: messages.nav.simulate }));
    });
    expect(push).toHaveBeenCalledWith("/simulate");
  });

  it("opens the command palette", () => {
    const heard = vi.fn();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, heard);
    renderMenu();
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: messages.shell.commandPalette }));
    });
    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("palette chord label", () => {
  it("reads Ctrl K off macOS", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    expect(renderHook(() => usePaletteChordLabel()).result.current).toBe("Ctrl K");
  });

  it("reads ⌘K on macOS", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(renderHook(() => usePaletteChordLabel()).result.current).toBe("⌘K");
  });
});
