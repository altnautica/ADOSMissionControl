/**
 * @module cockpit/flight/flight-context
 * @description The flight screen's measured grid (zone rectangles) for every
 * zone component, and the chrome tokens (`tokens.json` `chrome`) as CSS
 * custom properties on the cockpit root, so no panel hard-codes a colour.
 *
 * @license GPL-3.0-only
 */

"use client";

import { createContext, useContext, type CSSProperties } from "react";

import tokens from "@/lib/cockpit-spec/tokens.json";
import { flightGrid, type FlightGrid } from "./flight-grid";

export const FlightGridContext = createContext<FlightGrid>(
  flightGrid({ width: 1280, height: 720, widthClass: "expanded" }),
);

export function useFlightGrid(): FlightGrid {
  return useContext(FlightGridContext);
}

const c = tokens.chrome;

/** `#RRGGBBAA` (spec form) to a CSS `rgb(r g b / a)`. */
function hexa(hex: string): string {
  const v = hex.replace("#", "");
  const n = (i: number) => parseInt(v.slice(i, i + 2), 16);
  const a = v.length === 8 ? n(6) / 255 : 1;
  return `rgb(${n(0)} ${n(2)} ${n(4)} / ${a.toFixed(3)})`;
}

/** The chrome tokens as custom properties, scaled for the class. */
export function chromeVars(scale: number): CSSProperties {
  const px = (v: number) => `${Math.round(v * scale * 10) / 10}px`;
  return {
    "--fs-bg": hexa(c.panel_bg),
    "--fs-bg-solid": hexa(c.panel_bg_no_blur),
    "--fs-blur": `${c.panel_blur_px}px`,
    "--fs-border": hexa(c.border),
    "--fs-border-px": `${c.border_px}px`,
    "--fs-radius": px(c.radius_px),
    "--fs-radius-sm": px(c.radius_small_px),
    "--fs-text": hexa(c.text),
    "--fs-text-dim": hexa(c.text_dim),
    "--fs-ok": hexa(c.severity_ok),
    "--fs-warn": hexa(c.severity_warning),
    "--fs-crit": hexa(c.severity_critical),
    "--fs-stop-bg": hexa(c.stop_bg),
    "--fs-stop-text": hexa(c.stop_text),
    "--fs-top-px": px(c.type.top_bar_px),
    "--fs-top-line": px(c.type.top_bar_line_px),
    "--fs-value-px": px(c.type.value_px),
    "--fs-label-px": px(c.type.label_px),
    "--fs-chip-px": px(c.type.chip_px),
    "--fs-chip-weight": String(c.type.chip_weight),
    "--fs-icon": px(c.icon_px),
    "--fs-gap": px(c.gap_px),
    "--fs-pad": px(c.pad_px),
  } as CSSProperties;
}

/** Severity colours from the chrome tokens, for inline SVG fills. */
export const SEVERITY_VAR = {
  ok: "var(--fs-ok)",
  warning: "var(--fs-warn)",
  critical: "var(--fs-crit)",
} as const;
