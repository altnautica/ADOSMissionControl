/**
 * A flight record freezes the pilot and aircraft identity at arm time. Every
 * compliance surface (validator, CSV / JSON / XML, both PDF templates through
 * the shared resolvers) must certify the pilot and aircraft that flew, not
 * whoever the profile names on the day of the export.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { AircraftRecord, FlightRecord, OperatorProfile } from "@/lib/types";
import { JURISDICTIONS } from "@/lib/compliance/jurisdictions";
import { exportComplianceCsv } from "@/lib/compliance/csv-exporter";
import { exportComplianceXml } from "@/lib/compliance/xml-exporter";
import { validateForJurisdiction } from "@/lib/compliance/validator";
import {
  commonPilot,
  resolveAircraftIdentity,
  resolvePilot,
} from "@/lib/compliance/field-reader";

/** A flight flown in March by the pilot and aircraft of that day. */
function marchFlight(overrides: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "flight-march",
    droneId: "d1",
    droneName: "Alpha",
    date: 1_741_000_000_000,
    startTime: 1_741_000_000_000,
    endTime: 1_741_000_600_000,
    duration: 600,
    distance: 800,
    maxAlt: 40,
    maxSpeed: 8,
    batteryUsed: 30,
    waypointCount: 0,
    status: "completed",
    updatedAt: 1_741_000_600_000,
    pilotFirstName: "MarchPilot",
    pilotLastName: "One",
    pilotLicenseNumber: "LIC-MARCH",
    pilotLicenseIssuer: "DGCA",
    aircraftRegistration: "REG-MARCH",
    aircraftSerial: "SN-MARCH",
    aircraftMtomKg: 1.9,
    ...overrides,
  };
}

/** The profile and registry as edited in June. */
const juneOperator: OperatorProfile = {
  pilotFirstName: "JunePilot",
  pilotLastName: "Two",
  pilotLicenseNumber: "LIC-JUNE",
  pilotLicenseIssuer: "FAA",
  operatorName: "Example Operator",
};
const juneAircraft: AircraftRecord = {
  id: "d1",
  name: "Alpha",
  registrationNumber: "REG-JUNE",
  serialNumber: "SN-JUNE",
  mtomKg: 2.5,
} as AircraftRecord;

describe("compliance identity of a past flight", () => {
  it("resolves the pilot and aircraft frozen at arm time over the edited profile", () => {
    expect(resolvePilot(marchFlight(), juneOperator)).toEqual({
      firstName: "MarchPilot",
      lastName: "One",
      licenseNumber: "LIC-MARCH",
      licenseIssuer: "DGCA",
    });
    expect(resolveAircraftIdentity(marchFlight(), juneAircraft)).toEqual({
      registration: "REG-MARCH",
      serial: "SN-MARCH",
      mtomKg: 1.9,
    });
  });

  it("falls back to the live profile only for a record without a snapshot", () => {
    const legacy = marchFlight({
      pilotFirstName: undefined,
      pilotLastName: undefined,
      pilotLicenseNumber: undefined,
      pilotLicenseIssuer: undefined,
      aircraftRegistration: undefined,
    });
    expect(resolvePilot(legacy, juneOperator).licenseNumber).toBe("LIC-JUNE");
    expect(resolveAircraftIdentity(legacy, juneAircraft).registration).toBe("REG-JUNE");
  });

  it("exports the March pilot and registration to CSV", () => {
    const csv = exportComplianceCsv([marchFlight()], JURISDICTIONS.IN_DGCA, juneOperator, { d1: juneAircraft });
    expect(csv).toContain("MarchPilot");
    expect(csv).toContain("LIC-MARCH");
    expect(csv).toContain("REG-MARCH");
    expect(csv).not.toContain("LIC-JUNE");
    expect(csv).not.toContain("REG-JUNE");
  });

  it("names the flying pilot in the XML operator block, and nobody when flights disagree", () => {
    const one = exportComplianceXml([marchFlight()], JURISDICTIONS.IN_DGCA, juneOperator, { d1: juneAircraft });
    const operatorBlock = one.slice(one.indexOf("<operator>"), one.indexOf("</operator>"));
    expect(operatorBlock).toContain("<pilotLicenseNumber>LIC-MARCH</pilotLicenseNumber>");
    expect(one).not.toContain("LIC-JUNE");

    const mixed = [marchFlight(), marchFlight({ id: "flight-april", pilotFirstName: "AprilPilot", pilotLicenseNumber: "LIC-APRIL" })];
    expect(commonPilot(mixed, juneOperator)).toBeNull();
    const two = exportComplianceXml(mixed, JURISDICTIONS.IN_DGCA, juneOperator, { d1: juneAircraft });
    const mixedOperator = two.slice(two.indexOf("<operator>"), two.indexOf("</operator>"));
    expect(mixedOperator).toContain("<pilotLicenseNumber />");
    expect(two).not.toContain("LIC-JUNE");
  });

  it("validates a snapshotted flight even after the pilot is removed from the profile", () => {
    const issues = validateForJurisdiction(marchFlight(), { operatorName: "Example Operator" }, undefined, "IN_DGCA");
    const errors = issues.filter((i) => i.severity === "error").map((i) => i.field);
    expect(errors).not.toContain("operator.pilotLicenseNumber");
    expect(errors).not.toContain("aircraft.registrationNumber");
  });
});
