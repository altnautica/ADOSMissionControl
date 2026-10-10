/**
 * @module cockpit/cockpit-theme.test
 * @description The cockpit must not opt out of the theme system.
 *
 * Every cockpit colour comes from the generated `--hud-*` roles, which each
 * theme overrides. A literal colour in the cockpit rules would stop a theme at
 * the cockpit boundary — including `nvg`, whose entire purpose is to preserve
 * an operator's dark adaptation on a night flight.
 *
 * This reads the real stylesheets rather than a rendered DOM, because the
 * defect is a missing cascade rule and jsdom does not resolve custom-property
 * inheritance across a `[data-theme]` ancestor.
 *
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const TOKENS = readFileSync(
  join(process.cwd(), "src/styles/tokens.generated.css"),
  "utf8",
);

/** Every rule whose selector is scoped by `.ados-cockpit`. */
function cockpitRules(): string[] {
  const rules: string[] = [];
  const re = /([^{}]*\.ados-cockpit[^{}]*)\{([^{}]*)\}/g;
  for (const m of GLOBALS.matchAll(re)) rules.push(`${m[1].trim()} { ${m[2]} }`);
  return rules;
}

/** The declarations of the first block whose selector is exactly `selector`. */
function block(css: string, selector: string): string | null {
  const at = css.indexOf(selector + " {");
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

const HUD_ROLES = ["--hud-primary", "--hud-good", "--hud-warn", "--hud-crit", "--hud-ink"];

describe("cockpit palette", () => {
  it("uses no literal colour anywhere in the cockpit rules", () => {
    const rules = cockpitRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule, rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule, rule).not.toMatch(/rgba?\(/);
    }
  });

  it("drives the cockpit from the generated HUD roles", () => {
    const joined = cockpitRules().join("\n");
    for (const role of HUD_ROLES) expect(joined).toContain(`var(${role})`);
  });

  it("gives night-vision and light their own HUD roles", () => {
    for (const theme of ["nvg", "light"]) {
      const body = block(TOKENS, `html[data-theme="${theme}"]`);
      expect(body, theme).not.toBeNull();
      for (const role of HUD_ROLES) expect(body, `${theme} ${role}`).toContain(`${role}:`);
    }
  });

  it("keeps night vision off the bright default HUD colour", () => {
    const base = block(TOKENS, ":root");
    const nvg = block(TOKENS, 'html[data-theme="nvg"]');
    const primary = (css: string | null) => css?.match(/--hud-primary:\s*([^;]+);/)?.[1];
    expect(primary(nvg)).toBeDefined();
    expect(primary(nvg)).not.toBe(primary(base));
  });
});
