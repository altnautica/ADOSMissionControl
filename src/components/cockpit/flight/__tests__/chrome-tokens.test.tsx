/**
 * @license GPL-3.0-only
 *
 * The flight screen's chrome reads the cockpit spec's tokens: the panel
 * background (`chrome.panel_bg`, its alpha included) on every panel and
 * sheet, the lighter critical text colour for red text on a panel, and the
 * STOP fill under its white label. The local map's zoom buttons are 48 px
 * hit areas stepping 48 px, with the 20 px glyph box drawn inside.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import tokens from "@/lib/cockpit-spec/tokens.json";
import { chromeVars } from "../flight-context";

/** The real stylesheet's flight-screen and local-map rules, without the
 * conditional blocks (no-blur fallback, reduced motion, container queries). */
function flightCss(): string {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(?:supports|media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const rules: string[] = [];
  for (const m of css.matchAll(/([^{}@]*(?:\.ados-cockpit|\.lfmap)[^{}]*)\{([^{}]*)\}/g)) {
    rules.push(`${m[1].trim()} { ${m[2]} }`);
  }
  return rules.join("\n");
}

/** `#RRGGBB[AA]` as the `rgb(r g b / a)` the chrome variables carry. */
function rgb(hex: string): string {
  const v = hex.replace("#", "");
  const n = (i: number) => parseInt(v.slice(i, i + 2), 16);
  const a = v.length === 8 ? n(6) / 255 : 1;
  return `rgb(${n(0)} ${n(2)} ${n(4)} / ${a.toFixed(3)})`;
}

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = flightCss();
  document.head.appendChild(style);
});
afterAll(() => style.remove());

/** A flight-screen root carrying the chrome variables, with `html` inside. */
function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ados-cockpit flight-screen";
  for (const [k, v] of Object.entries(chromeVars(1))) root.style.setProperty(k, String(v));
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("flight-screen chrome tokens", () => {
  it("publishes the panel background, critical text and STOP fill from tokens.json", () => {
    const vars = chromeVars(1) as Record<string, string>;
    expect(tokens.chrome.panel_bg).toBe("#0B0D12EB");
    expect(vars["--fs-bg"]).toBe(rgb(tokens.chrome.panel_bg));
    expect(vars["--fs-bg"]).toBe("rgb(11 13 18 / 0.922)");
    expect(vars["--fs-text-crit"]).toBe(rgb(tokens.chrome.text_critical));
    expect(vars["--fs-text-crit"]).toBe("rgb(255 138 128 / 1.000)");
    expect(vars["--fs-stop-bg"]).toBe("rgb(200 30 30 / 1.000)");
    expect(vars["--fs-stop-text"]).toBe("rgb(255 255 255 / 1.000)");
  });

  /** The last `prop` declared by a stylesheet rule matching `el` (the
   * environment does not expand a `background` shorthand holding a var). */
  function declared(el: Element, prop: string): string | null {
    let value: string | null = null;
    for (const m of flightCss().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      let hit = false;
      try {
        hit = el.matches(m[1].trim());
      } catch {
        hit = false;
      }
      if (!hit) continue;
      const d = m[2].match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`));
      if (d) value = d[1].trim();
    }
    return value;
  }

  it("paints panels, sheets and the glass panels on the flight screen with the panel token", () => {
    const root = mount(
      `<div class="fs-panel" id="p"></div><div class="fs-sheet" id="s"></div>` +
        `<div class="glass-panel" id="g"></div><button class="glass-pill" id="c"></button>`,
    );
    for (const id of ["p", "s", "g", "c"]) {
      expect(declared(root.querySelector(`#${id}`)!, "background"), id).toBe("var(--fs-bg)");
    }
    root.remove();
  });

  it("fills STOP with the stop token under the stop text colour, and colours panel red text with the critical text token", () => {
    const root = mount(
      `<button class="fs-stop" id="stop"><span>STOP</span></button>` +
        `<span class="fs-rec" id="rec"></span><span class="fs-text-crit" id="crit"></span>`,
    );
    const stop = root.querySelector("#stop")!;
    expect(declared(stop, "background")).toBe("var(--fs-stop-bg)");
    expect(getComputedStyle(stop).color).toBe(rgb(tokens.chrome.stop_text));
    for (const id of ["rec", "crit"]) {
      expect(getComputedStyle(root.querySelector(`#${id}`)!).color, id).toBe(rgb(tokens.chrome.text_critical));
    }
    root.remove();
  });
});

describe("local map zoom buttons", () => {
  it("are 48 px transparent hit areas in a column that steps 48 px", () => {
    const root = document.createElement("div");
    root.className = "lfmap";
    root.innerHTML = `<div class="lfmap-zoom"><button id="in"><svg></svg></button><button id="out"><svg></svg></button></div>`;
    document.body.appendChild(root);
    const column = getComputedStyle(root.querySelector(".lfmap-zoom")!);
    expect(column.flexDirection).toBe("column");
    expect(column.getPropertyValue("gap")).toBe("0");
    for (const id of ["in", "out"]) {
      const b = getComputedStyle(root.querySelector(`#${id}`)!);
      expect(b.width, id).toBe("48px");
      expect(b.height, id).toBe("48px");
      expect(b.getPropertyValue("background"), id).toBe("transparent");
    }
    root.remove();
  });

  it("draws the 20 px glyph box inside the hit area", () => {
    const css = flightCss();
    const glyph = css.match(/\.lfmap \.lfmap-zoom button::before \{([^}]*)\}/)?.[1] ?? "";
    expect(glyph).toMatch(/width: 20px/);
    expect(glyph).toMatch(/height: 20px/);
    expect(glyph).toMatch(/left: 50%/);
    expect(glyph).toMatch(/top: 50%/);
  });
});
