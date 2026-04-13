/**
 * PDF section registry — maps section IDs to metadata.
 *
 * Phase 31b — modular PDF builder.
 *
 * @license GPL-3.0-only
 */

export interface PdfSectionDef {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  /** Group for UI organization. */
  group: "core" | "environment" | "analysis" | "equipment" | "metadata";
}

export const PDF_SECTIONS: PdfSectionDef[] = [
  // Core — always relevant
  { id: "pilot-operator", label: "Pilot & Operator", description: "Names, license, cert, insurance", defaultOn: true, group: "core" },
  { id: "aircraft", label: "Aircraft", description: "Registration, serial, manufacturer, MTOM", defaultOn: true, group: "core" },
  { id: "flight-core", label: "Flight Core", description: "Date, duration, distance, altitude, speed, battery, status", defaultOn: true, group: "core" },
  { id: "location", label: "Location", description: "Takeoff/landing coords + place names", defaultOn: true, group: "core" },

  // Environment
  { id: "weather", label: "Weather", description: "METAR: temp, wind, visibility, ceiling, flight category", defaultOn: false, group: "environment" },
  { id: "sun-moon", label: "Sun & Moon", description: "Sunrise/sunset, daylight phase, moon phase", defaultOn: false, group: "environment" },
  { id: "wind", label: "Wind Estimate", description: "FC-derived wind speed + direction", defaultOn: false, group: "environment" },
  { id: "airspace", label: "Airspace", description: "Intersected zones, NOTAMs, TFRs", defaultOn: false, group: "environment" },

  // Analysis
  { id: "events", label: "Events Timeline", description: "Chronological flight events with severity", defaultOn: false, group: "analysis" },
  { id: "health", label: "Health Summary", description: "GPS quality, vibration RMS, battery health", defaultOn: false, group: "analysis" },
  { id: "phases", label: "Flight Phases", description: "Takeoff, climb, cruise, hover, descent, land breakdown", defaultOn: false, group: "analysis" },
  { id: "adherence", label: "Mission Adherence", description: "Waypoints reached, cross-track error", defaultOn: false, group: "analysis" },
  { id: "geofence", label: "Geofence", description: "Breach list with type, zone, distance", defaultOn: false, group: "analysis" },
  { id: "kpis", label: "Suite KPIs", description: "Per-suite metrics (area, efficiency, etc.)", defaultOn: false, group: "analysis" },

  // Equipment
  { id: "preflight", label: "Pre-flight", description: "Checklist items, prearm failures, SYS_STATUS", defaultOn: false, group: "equipment" },
  { id: "loadout", label: "Loadout", description: "Battery, props, motors, camera, gimbal, payload", defaultOn: false, group: "equipment" },

  // Metadata
  { id: "media", label: "Media", description: "Attached photo/video count + filenames", defaultOn: false, group: "metadata" },
  { id: "notes", label: "Notes & Tags", description: "Custom name, tags, markdown notes", defaultOn: false, group: "metadata" },
  { id: "signature", label: "Signature", description: "Pilot signature hash + timestamp", defaultOn: true, group: "metadata" },
];

/** Preset section sets. */
export const PDF_PRESETS: Record<string, { label: string; sections: string[] }> = {
  minimal: {
    label: "Minimal",
    sections: ["flight-core"],
  },
  standard: {
    label: "Standard",
    sections: ["pilot-operator", "aircraft", "flight-core", "location", "signature"],
  },
  detailed: {
    label: "Detailed",
    sections: ["pilot-operator", "aircraft", "flight-core", "location", "weather", "events", "health", "phases", "notes", "signature"],
  },
  forensic: {
    label: "Forensic",
    sections: PDF_SECTIONS.map((s) => s.id),
  },
  insurance: {
    label: "Insurance",
    sections: ["pilot-operator", "aircraft", "flight-core", "location", "loadout", "preflight", "health", "media", "signature"],
  },
};

/** Get default sections (all with defaultOn: true). */
export function getDefaultSections(): string[] {
  return PDF_SECTIONS.filter((s) => s.defaultOn).map((s) => s.id);
}
