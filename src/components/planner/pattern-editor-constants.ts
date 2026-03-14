/**
 * @module pattern-editor-constants
 * @description Constants and option arrays for the PatternEditor component.
 * @license GPL-3.0-only
 */

import { CAMERA_PROFILES } from "@/lib/patterns/gsd-calculator";

export const PATTERN_TYPE_OPTIONS = [
  { value: "survey", label: "Survey Grid", description: "Grid/lawnmower pattern for area coverage and mapping" },
  { value: "orbit", label: "Orbit", description: "Circular flight around a point of interest" },
  { value: "corridor", label: "Corridor", description: "Linear corridor sweep along a path" },
  { value: "expandingSquare", label: "SAR: Expanding Square", description: "Search pattern expanding outward from a datum point" },
  { value: "sectorSearch", label: "SAR: Sector Search", description: "Pie-slice search radiating from a datum point" },
  { value: "parallelTrack", label: "SAR: Parallel Track", description: "Systematic parallel sweeps across a search area" },
  { value: "structureScan", label: "Structure Scan", description: "Multi-layer orbit for 3D structure inspection" },
];

export const ENTRY_LOCATION_OPTIONS = [
  { value: "topLeft", label: "Top Left" },
  { value: "topRight", label: "Top Right" },
  { value: "bottomLeft", label: "Bottom Left" },
  { value: "bottomRight", label: "Bottom Right" },
];

export const DIRECTION_OPTIONS = [
  { value: "cw", label: "Clockwise" },
  { value: "ccw", label: "Counter-clockwise" },
];

export const SCAN_DIRECTION_OPTIONS = [
  { value: "bottom-up", label: "Bottom Up" },
  { value: "top-down", label: "Top Down" },
];

export const CAMERA_OPTIONS = [
  { value: "", label: "Manual" },
  ...CAMERA_PROFILES.map((c) => ({ value: c.name, label: c.name })),
];

export const VALID_PATTERN_TYPES = new Set(PATTERN_TYPE_OPTIONS.map((o) => o.value));

export interface SurveyPreset {
  label: string;
  sidelap: number;
  frontlap: number;
  altitude: number;
  speed: number;
  tieLines?: boolean;
  description: string;
}

export const SURVEY_PRESETS: SurveyPreset[] = [
  { label: "Photogrammetry Standard", sidelap: 80, frontlap: 70, altitude: 50, speed: 5, description: "Most common mapping preset" },
  { label: "High Detail", sidelap: 90, frontlap: 80, altitude: 30, speed: 3, description: "Dense 3D reconstruction" },
  { label: "Quick Overview", sidelap: 60, frontlap: 50, altitude: 80, speed: 8, description: "Fast area coverage" },
  { label: "Inspection", sidelap: 70, frontlap: 60, altitude: 30, speed: 2, description: "Close-range inspection" },
  { label: "Magnetic Survey", sidelap: 60, frontlap: 50, altitude: 50, speed: 5, tieLines: true, description: "Tie lines enabled for calibration" },
];

export const SURVEY_PRESET_OPTIONS = [
  { value: "", label: "Custom" },
  ...SURVEY_PRESETS.map((p) => ({ value: p.label, label: p.label, description: p.description })),
];
