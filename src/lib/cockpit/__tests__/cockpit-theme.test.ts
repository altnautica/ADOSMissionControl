/**
 * @module cockpit/cockpit-theme.test
 * @description The cockpit must not opt out of the theme system.
 *
 * `.ados-cockpit` hardcoded its whole palette as literals, so every theme
 * stopped at the cockpit boundary — including `nvg`, whose entire purpose is
 * to preserve an operator's dark adaptation on a night flight. The one surface
 * they actually fly from stayed bright blue and amber after they picked the
 * night-vision theme.
 *
 * This reads the real stylesheet rather than a rendered DOM, because the
 * defect is a missing cascade rule and jsdom does not resolve custom-property
 * inheritance across a `[data-theme]` ancestor.
 *
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** The block body for a selector, or null when the selector is absent. */
function block(selector: string): string | null {
  const at = CSS.indexOf(selector + " {");
  if (at === -1) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

/** Semantic colours an operator reads a state from. */
const STATUS_VARS = ["--good", "--warn", "--crit"] as const;

describe("cockpit palette", () => {
  it("keeps the artifact's literal palette as the default theme", () => {
    const base = block(".ados-cockpit");
    expect(base).not.toBeNull();
    // The default cockpit is the reference artifact, verbatim.
    expect(base).toContain("--good: #37d99a");
    expect(base).toContain("--warn: #f5b544");
    expect(base).toContain("--crit: #ff5a52");
    expect(base).toContain("--hud: #63b3ff");
  });

  it("follows the night-vision theme, which is what that theme is for", () => {
    const nvg = block('html[data-theme="nvg"] .ados-cockpit');
    expect(
      nvg,
      "nvg must reach the cockpit: a bright cockpit destroys the dark adaptation the theme exists to preserve",
    ).not.toBeNull();

    // Every status colour and the HUD come from the theme, not a literal.
    for (const v of STATUS_VARS) {
      expect(nvg, v).toMatch(new RegExp(`${v}:\\s*var\\(--alt-status-`));
    }
    expect(nvg).toMatch(/--hud:\s*var\(--gcs-hud-green\)/);
    expect(nvg).toMatch(/--ink:\s*var\(--alt-text-primary\)/);

    // No literal hex may sneak back in: that is exactly how the cockpit
    // stopped following themes in the first place.
    expect(nvg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("gives every light theme themed status colours", () => {
    // A glass-over-video cockpit keeps dark chrome on purpose, but a status
    // colour tuned for a dark page is not legible over bright imagery.
    for (const theme of ["light", "solarized-light", "catppuccin-latte", "gruvbox-light"]) {
      expect(
        CSS,
        `${theme} must reach the cockpit's status colours`,
      ).toContain(`html[data-theme="${theme}"] .ados-cockpit`);
    }
  });

  it("has no cockpit rule anchoring a fixture at a bottom corner", () => {
    // The retired `.zone.bl` / `.zone.br` anchors collided with the
    // arrangeable-widget containers at the same coordinates and z-index.
    expect(CSS).not.toMatch(/\.ados-cockpit \.zone\.bl \{/);
    expect(CSS).not.toMatch(/\.ados-cockpit \.zone\.br \{/);
    // The containers that replaced them are still there.
    expect(CSS).toMatch(/\.ados-cockpit \.cockpit-zone\.bl \{/);
    expect(CSS).toMatch(/\.ados-cockpit \.cockpit-zone\.br \{/);
  });
});
