/**
 * @module ados-theme
 * @description Dark theme for Blockly workspace matching GCS design tokens.
 * @license GPL-3.0-only
 */

import * as Blockly from "blockly";

/** Category colors matching GCS accent palette */
export const CATEGORY_COLORS = {
  movement: "#3A82FF",    // accent-primary (blue)
  sensors: "#DFF140",     // accent-secondary (lime)
  camera: "#F97316",      // orange
  logic: "#A855F7",       // purple
  events: "#EC4899",      // pink
  loops: "#14B8A6",       // teal
  variables: "#EF4444",   // red
} as const;

export const adosTheme = Blockly.Theme.defineTheme("ados-dark", {
  name: "ados-dark",
  base: Blockly.Themes.Classic,
  blockStyles: {
    movement_blocks: { colourPrimary: CATEGORY_COLORS.movement, colourSecondary: "#2563EB", colourTertiary: "#1D4ED8" },
    sensor_blocks: { colourPrimary: "#6B8E23", colourSecondary: "#556B2F", colourTertiary: "#4B5320" },
    camera_blocks: { colourPrimary: CATEGORY_COLORS.camera, colourSecondary: "#EA580C", colourTertiary: "#C2410C" },
    logic_blocks: { colourPrimary: CATEGORY_COLORS.logic, colourSecondary: "#9333EA", colourTertiary: "#7E22CE" },
    event_blocks: { colourPrimary: CATEGORY_COLORS.events, colourSecondary: "#DB2777", colourTertiary: "#BE185D" },
    loop_blocks: { colourPrimary: CATEGORY_COLORS.loops, colourSecondary: "#0D9488", colourTertiary: "#0F766E" },
    variable_blocks: { colourPrimary: CATEGORY_COLORS.variables, colourSecondary: "#DC2626", colourTertiary: "#B91C1C" },
  },
  categoryStyles: {
    movement_category: { colour: CATEGORY_COLORS.movement },
    sensor_category: { colour: CATEGORY_COLORS.sensors },
    camera_category: { colour: CATEGORY_COLORS.camera },
    logic_category: { colour: CATEGORY_COLORS.logic },
    event_category: { colour: CATEGORY_COLORS.events },
    loop_category: { colour: CATEGORY_COLORS.loops },
    variable_category: { colour: CATEGORY_COLORS.variables },
  },
  componentStyles: {
    workspaceBackgroundColour: "#0A0A0F",
    toolboxBackgroundColour: "#12121A",
    toolboxForegroundColour: "#E8E8ED",
    flyoutBackgroundColour: "#1A1A25",
    flyoutForegroundColour: "#E8E8ED",
    flyoutOpacity: 0.95,
    scrollbarColour: "#3A3A4A",
    scrollbarOpacity: 0.5,
    insertionMarkerColour: "#3A82FF",
    insertionMarkerOpacity: 0.5,
    cursorColour: "#3A82FF",
  },
  fontStyle: {
    family: "'JetBrains Mono', 'Space Grotesk', monospace",
    weight: "500",
    size: 11,
  },
});
