/**
 * @module map/context-menu/types
 * @description Shared types for the right-click flight map menu.
 * @license GPL-3.0-only
 */

export interface MenuPosition {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

/**
 * How a map-menu action reports what actually happened.
 *
 * Every action handler here was `void` and swallowed its result, so a command
 * the vehicle rejected looked identical to one it accepted. Flight-affecting
 * menu items report through this.
 */
export type MenuReport = (
  message: string,
  status: "success" | "warning" | "error" | "info",
) => void;

export interface MenuItemDef {
  id: string;
  label: string;
  icon: string;
  group: number;
  shortcut?: string;
  danger?: boolean;
}
