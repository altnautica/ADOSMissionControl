/**
 * @module fc/chart-theme
 * @description Chart colours for the flight-controller panels, expressed as
 * theme CSS variables so every chart follows the active theme. SVG
 * presentation attributes and recharts style props both accept `var(...)`.
 * @license GPL-3.0-only
 */

import type { CSSProperties } from "react";

/** Per-axis series colours: roll/x, pitch/y, yaw/z. */
export const AXIS_COLORS = {
  roll: "var(--color-accent-primary)",
  pitch: "var(--color-status-success)",
  yaw: "var(--color-status-warning)",
} as const;

export const XYZ_COLORS = {
  x: AXIS_COLORS.roll,
  y: AXIS_COLORS.pitch,
  z: AXIS_COLORS.yaw,
} as const;

/** Distinct series colours for per-motor traces (up to eight motors). */
export const MOTOR_COLORS = [
  "var(--color-accent-primary)",
  "var(--color-status-success)",
  "var(--color-status-warning)",
  "var(--color-status-error)",
  "var(--color-accent-secondary)",
  "var(--color-status-serious)",
  "var(--color-gcs-hud-green)",
  "var(--color-text-secondary)",
] as const;

export const CHART_GRID = "var(--color-border-default)";
export const CHART_TICK = "var(--color-text-tertiary)";
export const CHART_LABEL = "var(--color-text-secondary)";
export const CHART_WARNING = "var(--color-status-warning)";
export const CHART_ERROR = "var(--color-status-error)";
export const CHART_SUCCESS = "var(--color-status-success)";

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 0,
  fontSize: 11,
};

export const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = { color: CHART_LABEL };

/** A lighter tint of a series colour, used for the "desired" trace beside the measured one. */
export function tint(color: string): string {
  return `color-mix(in srgb, ${color} 60%, var(--color-text-primary))`;
}
