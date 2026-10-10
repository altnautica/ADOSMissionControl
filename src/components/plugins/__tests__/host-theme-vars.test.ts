/**
 * The base role map an extension receives follows the host theme's colour
 * scheme, not its id: a light community theme must not hand extensions the
 * dark-scheme roles.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { extensionThemeFor } from "../host-theme-vars";

describe("extensionThemeFor", () => {
  it.each([
    ["light", "brand-light"],
    ["solarized-light", "brand-light"],
    ["catppuccin-latte", "brand-light"],
    ["gruvbox-light", "brand-light"],
    ["dark", "brand-dark"],
    ["solarized-dark", "brand-dark"],
    ["ayu-mirage", "brand-dark"],
    ["nvg", "nvg"],
    [null, "brand-dark"],
  ] as const)("%s -> %s", (theme, base) => {
    expect(extensionThemeFor(theme)).toBe(base);
  });
});
