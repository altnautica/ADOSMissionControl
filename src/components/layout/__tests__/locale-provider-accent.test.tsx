/**
 * Night vision always wins over the operator's accent choice: while the nvg
 * theme is active no inline accent override sits on the root (so badges and
 * chips take the theme's own green), and leaving nvg restores the choice.
 * @license GPL-3.0-only
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@/components/layout/LocaleProvider";
import { useSettingsStore } from "@/stores/settings-store";

const rootStyle = () => document.documentElement.style;

describe("LocaleProvider accent override", () => {
  beforeEach(async () => {
    // Let the persisted store finish its async read first, so it cannot
    // overwrite the theme and accent this test sets.
    await useSettingsStore.persist.rehydrate();
    useSettingsStore.setState({ themeMode: "dark", accentColor: "orange" });
  });
  afterEach(() => {
    cleanup();
    for (const name of ["--alt-accent-primary", "--alt-accent-primary-hover", "--alt-accent-secondary"]) {
      rootStyle().removeProperty(name);
    }
    useSettingsStore.setState({ themeMode: "dark", accentColor: "blue" });
  });

  it("writes the chosen accent outside night vision", () => {
    render(<LocaleProvider>{null}</LocaleProvider>);
    expect(rootStyle().getPropertyValue("--alt-accent-primary")).toBe("#f97316");
  });

  it("drops the override under nvg and restores it when leaving nvg", async () => {
    render(<LocaleProvider>{null}</LocaleProvider>);
    await act(async () => {
      useSettingsStore.setState({ themeMode: "nvg" });
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("nvg");
    expect(rootStyle().getPropertyValue("--alt-accent-primary")).toBe("");
    expect(rootStyle().getPropertyValue("--alt-accent-primary-hover")).toBe("");
    expect(rootStyle().getPropertyValue("--alt-accent-secondary")).toBe("");

    // An accent change while nvg is active must not re-apply the override.
    await act(async () => {
      useSettingsStore.setState({ accentColor: "pink" });
    });
    expect(rootStyle().getPropertyValue("--alt-accent-primary")).toBe("");

    await act(async () => {
      useSettingsStore.setState({ themeMode: "dark" });
    });
    expect(rootStyle().getPropertyValue("--alt-accent-primary")).toBe("#ec4899");
    expect(rootStyle().getPropertyValue("--alt-accent-secondary")).toBe("#f9a8d4");
  });
});
