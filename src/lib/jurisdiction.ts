/**
 * @module jurisdiction
 * @description Jurisdiction config map, unit conversion helpers, and display formatters.
 * All internal data is SI. Conversion happens at the display layer only.
 * @license GPL-3.0-only
 */

export type Jurisdiction = "dgca" | "faa" | "casa" | "easa" | "caa_uk" | "caac" | "jcab" | "tcca";

export interface JurisdictionConfig {
  name: string;
  flag: string;
  defaultUnits: "metric" | "imperial";
  altitudeUnit: string;
  speedUnit: string;
  distanceUnit: string;
  tempUnit: string;
  maxAltitude: string;
  airspaceSystem: string;
  registrationLabel: string;
}

export const JURISDICTIONS: Record<Jurisdiction, JurisdictionConfig> = {
  dgca: {
    name: "DGCA",
    flag: "🇮🇳",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "122m",
    airspaceSystem: "Digital Sky",
    registrationLabel: "UIN",
  },
  faa: {
    name: "FAA",
    flag: "🇺🇸",
    defaultUnits: "imperial",
    altitudeUnit: "ft",
    speedUnit: "mph",
    distanceUnit: "miles",
    tempUnit: "°F",
    maxAltitude: "400ft",
    airspaceSystem: "LAANC",
    registrationLabel: "FAA N-number",
  },
  casa: {
    name: "CASA",
    flag: "🇦🇺",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "120m",
    airspaceSystem: "OpenSky",
    registrationLabel: "CASA ID",
  },
  easa: {
    name: "EASA",
    flag: "🇪🇺",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "120m",
    airspaceSystem: "U-Space",
    registrationLabel: "EASA Operator ID",
  },
  caa_uk: {
    name: "CAA UK",
    flag: "🇬🇧",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "120m",
    airspaceSystem: "Altitude Angel",
    registrationLabel: "Operator ID",
  },
  caac: {
    name: "CAAC",
    flag: "🇨🇳",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "120m",
    airspaceSystem: "UOM",
    registrationLabel: "UAS Registration",
  },
  jcab: {
    name: "JCAB",
    flag: "🇯🇵",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "150m",
    airspaceSystem: "DIPS 2.0",
    registrationLabel: "DIPS ID",
  },
  tcca: {
    name: "TCCA",
    flag: "🇨🇦",
    defaultUnits: "metric",
    altitudeUnit: "m",
    speedUnit: "km/h",
    distanceUnit: "km",
    tempUnit: "°C",
    maxAltitude: "122m",
    airspaceSystem: "NAV CANADA",
    registrationLabel: "RPAS Registration",
  },
};

/** Default config when no jurisdiction is selected — metric units, no regulatory labels. */
const DEFAULT_CONFIG: JurisdictionConfig = {
  name: "",
  flag: "",
  defaultUnits: "metric",
  altitudeUnit: "m",
  speedUnit: "km/h",
  distanceUnit: "km",
  tempUnit: "°C",
  maxAltitude: "",
  airspaceSystem: "",
  registrationLabel: "Registration",
};

export function getJurisdictionConfig(j: Jurisdiction | null): JurisdictionConfig {
  if (!j) return DEFAULT_CONFIG;
  return JURISDICTIONS[j];
}
