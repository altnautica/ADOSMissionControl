/**
 * @license GPL-3.0-only
 *
 * The theme picker offers night vision, and every accent swatch is a named
 * toggle button with a 48 px target.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import { ThemeSection } from "../ThemeSection";
import { LanguageSection } from "../LanguageSection";
import { useSettingsStore } from "@/stores/settings-store";

describe("ThemeSection", () => {
  it("lists night vision in the theme options", () => {
    render(<ThemeSection />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getAllByRole("combobox")[0] ?? screen.getAllByRole("button")[0]);
    expect(screen.getAllByText("Night vision").length).toBeGreaterThan(0);
  });

  it("names the accent swatches and marks the selected one", () => {
    useSettingsStore.setState({ accentColor: "blue" });
    render(<ThemeSection />, { wrapper: IntlWrapper });
    const blue = screen.getByRole("button", { name: "Blue" });
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    expect(blue.className).toContain("w-12");
    const others = screen.getAllByRole("button", { pressed: false });
    expect(others.length).toBeGreaterThan(0);
  });

  it("marks the selected language tile as pressed", () => {
    useSettingsStore.setState({ locale: "de" });
    render(<LanguageSection />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: /Deutsch/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /English/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
