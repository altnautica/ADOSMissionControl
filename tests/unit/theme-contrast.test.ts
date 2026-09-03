/**
 * @module theme-contrast.test
 * @description Every palette must paint a legible foreground on its own accent.
 *
 * `Button`'s primary variant hardcoded `text-white` on `bg-accent-primary`.
 * That is theme-invariant, and the accent is not: measured across the 22
 * palettes in `globals.css`, white failed WCAG AA (4.5:1) on 18 of them. The
 * worst is `nvg` at 1.37:1 — a bright-green button with white text, on the
 * night-vision theme whose entire purpose is preserving an operator's dark
 * adaptation. `light` and `github-dark` were the only ones with real margin.
 *
 * The fix is a per-theme `--alt-accent-foreground` token. This test is what
 * stops the next theme from being added without one, and what stops a future
 * accent tweak from silently dropping a palette below AA.
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

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG 2.x contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

interface Palette {
  name: string;
  accent: string;
  foreground: string | null;
}

/** Every `:root` / `html[data-theme=…]` block that defines an accent. */
function readPalettes(): Palette[] {
  const out: Palette[] = [];
  const block = /(^:root|^html\[data-theme="([^"]+)"\])\s*\{([\s\S]*?)^\}/gm;
  for (const m of CSS.matchAll(block)) {
    const [, selector, themeName, body] = m as unknown as [
      string,
      string,
      string | undefined,
      string,
    ];
    // The cockpit's private palette is a deliberately separate, deliberately
    // dark vocabulary and does not carry the app accent tokens.
    if (selector.includes(".ados-cockpit")) continue;
    const accent = /--alt-accent-primary:\s*(#[0-9a-fA-F]{6})/.exec(body);
    if (!accent) continue;
    const fg = /--alt-accent-foreground:\s*(#[0-9a-fA-F]{6})/.exec(body);
    out.push({
      name: themeName ?? ":root",
      accent: accent[1]!,
      foreground: fg ? fg[1]! : null,
    });
  }
  return out;
}

describe("theme accent contrast", () => {
  const palettes = readPalettes();

  it("finds every palette in globals.css", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true, which is the failure mode this whole pass keeps finding.
    expect(palettes.length).toBeGreaterThanOrEqual(20);
    expect(palettes.map((p) => p.name)).toContain(":root");
    expect(palettes.map((p) => p.name)).toContain("nvg");
  });

  it("gives every palette its own --alt-accent-foreground", () => {
    // Inheriting `:root`'s value is not good enough: `:root` resolves it
    // against `:root`'s accent, and a theme that overrides the accent without
    // overriding the foreground lands wherever the cascade leaves it.
    const missing = palettes.filter((p) => p.foreground === null);
    expect(
      missing.map((p) => p.name),
      "palettes missing --alt-accent-foreground",
    ).toEqual([]);
  });

  it("clears WCAG AA on every palette's accent", () => {
    const failing = palettes
      .map((p) => ({
        name: p.name,
        ratio: Number(contrast(p.accent, p.foreground!).toFixed(2)),
      }))
      .filter((r) => r.ratio < 4.5);
    expect(failing, "palettes below 4.5:1 on bg-accent-primary").toEqual([]);
  });

  it("records why plain white is not an option", () => {
    // Not decoration: this is the measurement that justifies the token. If a
    // future change makes white viable everywhere the token can go, and this
    // assertion is what will say so.
    const whiteFails = palettes.filter(
      (p) => contrast(p.accent, "#ffffff") < 4.5,
    );
    expect(whiteFails.length).toBeGreaterThan(10);
    const nvg = palettes.find((p) => p.name === "nvg")!;
    expect(contrast(nvg.accent, "#ffffff")).toBeLessThan(2);
  });

  it("keeps the token mapped into the Tailwind theme layer", () => {
    // The per-theme values are inert unless `@theme` exposes them as a
    // utility, which is what `text-accent-foreground` compiles from.
    expect(CSS).toContain(
      "--color-accent-foreground: var(--alt-accent-foreground)",
    );
  });
});
