/**
 * Generic compliance logbook template — used by every jurisdiction except
 * DGCA India (which gets its own purpose-built single-flight layout).
 *
 * Renders a multi-flight logbook A4 portrait with:
 *  - Cover (jurisdiction display name + regulator + regulation ref)
 *  - Pilot + operator block
 *  - Per-flight rows table (date, drone, reg, duration, distance, max alt, status)
 *  - Per-period summary (total flights, total hours, total distance)
 *  - Retention banner footer
 *
 * Single-record exports use the same component — the table just has one row.
 *
 * @license GPL-3.0-only
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { styles as baseStyles } from "../styles";
import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import type { JurisdictionSpec } from "../../jurisdictions";

const tableStyles = StyleSheet.create({
  table: {
    marginTop: 6,
    border: "1 solid #d5d5e0",
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f3f3f7",
    borderBottom: "1 solid #d5d5e0",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  bodyRow: {
    flexDirection: "row",
    borderBottom: "1 solid #ececf3",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  th: {
    fontSize: 7,
    fontWeight: 700,
    color: "#3f3f54",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  td: {
    fontSize: 8,
    color: "#0a0a0f",
    fontFamily: "Courier",
  },
  colDate: { width: "18%" },
  colDrone: { width: "14%" },
  colReg: { width: "14%" },
  colDuration: { width: "10%" },
  colDistance: { width: "12%" },
  colAlt: { width: "10%" },
  colStatus: { width: "12%" },
  colTakeoff: { width: "10%" },
  summary: {
    marginTop: 12,
    flexDirection: "row",
    gap: 24,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 7,
    color: "#6b6b7f",
    textTransform: "uppercase",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
});

interface GenericLogbookProps {
  spec: JurisdictionSpec;
  records: FlightRecord[];
  operator: OperatorProfile;
  aircraftIndex: Record<string, AircraftRecord>;
  generatedAt: Date;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}`;
}

function retentionLabel(months: number): string {
  if (months <= 0) return "No retention mandated by the regulator.";
  if (months % 12 === 0) return `Retain this record for ${months / 12} year${months === 12 ? "" : "s"}.`;
  return `Retain this record for ${months} months.`;
}

export function GenericLogbookTemplate({
  spec,
  records,
  operator,
  aircraftIndex,
  generatedAt,
}: GenericLogbookProps) {
  const totalSeconds = records.reduce((acc, r) => acc + (r.duration ?? 0), 0);
  const totalMeters = records.reduce((acc, r) => acc + (r.distance ?? 0), 0);

  return (
    <Document
      title={`${spec.displayName} Logbook`}
      author={operator.operatorName ?? operator.pilotFirstName ?? "ADOS Mission Control"}
    >
      <Page size="A4" style={baseStyles.page}>
        {/* Cover */}
        <View style={baseStyles.cover}>
          <Text style={baseStyles.brand}>Altnautica Mission Control · Compliance Logbook</Text>
          <Text style={baseStyles.title}>{spec.displayName}</Text>
          <Text style={baseStyles.subtitle}>{spec.regulator} · {spec.regulationRef}</Text>
        </View>

        {/* Pilot */}
        <View style={baseStyles.section}>
          <Text style={baseStyles.sectionTitle}>Pilot &amp; operator</Text>
          <View style={baseStyles.twoCol}>
            <View style={baseStyles.col}>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>Pilot</Text>
                <Text style={baseStyles.rowValue}>
                  {[operator.pilotFirstName, operator.pilotLastName].filter(Boolean).join(" ") || "—"}
                </Text>
              </View>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>License</Text>
                <Text style={baseStyles.rowValue}>{operator.pilotLicenseNumber ?? "—"}</Text>
              </View>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>Class</Text>
                <Text style={baseStyles.rowValue}>{operator.pilotLicenseClass ?? "—"}</Text>
              </View>
            </View>
            <View style={baseStyles.col}>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>Operator</Text>
                <Text style={baseStyles.rowValue}>{operator.operatorName ?? "—"}</Text>
              </View>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>Cert no.</Text>
                <Text style={baseStyles.rowValue}>{operator.operatorCertNumber ?? "—"}</Text>
              </View>
              <View style={baseStyles.row}>
                <Text style={baseStyles.rowLabel}>Insurance</Text>
                <Text style={baseStyles.rowValue}>
                  {operator.insurancePolicyNumber ? `${operator.insurerName ?? ""} ${operator.insurancePolicyNumber}` : "—"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Flights table */}
        <View style={baseStyles.section}>
          <Text style={baseStyles.sectionTitle}>
            Flights ({records.length})
          </Text>
          <View style={tableStyles.table}>
            <View style={tableStyles.headerRow}>
              <Text style={[tableStyles.th, tableStyles.colDate]}>Date</Text>
              <Text style={[tableStyles.th, tableStyles.colDrone]}>Drone</Text>
              <Text style={[tableStyles.th, tableStyles.colReg]}>Reg</Text>
              <Text style={[tableStyles.th, tableStyles.colDuration]}>Duration</Text>
              <Text style={[tableStyles.th, tableStyles.colDistance]}>Distance</Text>
              <Text style={[tableStyles.th, tableStyles.colAlt]}>Max alt</Text>
              <Text style={[tableStyles.th, tableStyles.colTakeoff]}>Takeoff</Text>
              <Text style={[tableStyles.th, tableStyles.colStatus]}>Status</Text>
            </View>
            {records.map((r) => {
              const aircraft = aircraftIndex[r.droneId];
              return (
                <View key={r.id} style={tableStyles.bodyRow} wrap={false}>
                  <Text style={[tableStyles.td, tableStyles.colDate]}>
                    {fmtDate(r.startTime ?? r.date)}
                  </Text>
                  <Text style={[tableStyles.td, tableStyles.colDrone]}>{r.droneName}</Text>
                  <Text style={[tableStyles.td, tableStyles.colReg]}>
                    {aircraft?.registrationNumber ?? r.aircraftRegistration ?? "—"}
                  </Text>
                  <Text style={[tableStyles.td, tableStyles.colDuration]}>
                    {fmtDuration(r.duration)}
                  </Text>
                  <Text style={[tableStyles.td, tableStyles.colDistance]}>
                    {(r.distance / 1000).toFixed(2)} km
                  </Text>
                  <Text style={[tableStyles.td, tableStyles.colAlt]}>{r.maxAlt} m</Text>
                  <Text style={[tableStyles.td, tableStyles.colTakeoff]}>
                    {r.takeoffLat !== undefined && r.takeoffLon !== undefined
                      ? `${r.takeoffLat.toFixed(3)},${r.takeoffLon.toFixed(3)}`
                      : "—"}
                  </Text>
                  <Text style={[tableStyles.td, tableStyles.colStatus]}>{r.status}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Summary */}
        <View style={tableStyles.summary}>
          <View style={tableStyles.summaryItem}>
            <Text style={tableStyles.summaryLabel}>Total flights</Text>
            <Text style={tableStyles.summaryValue}>{records.length}</Text>
          </View>
          <View style={tableStyles.summaryItem}>
            <Text style={tableStyles.summaryLabel}>Total hours</Text>
            <Text style={tableStyles.summaryValue}>{(totalSeconds / 3600).toFixed(2)}</Text>
          </View>
          <View style={tableStyles.summaryItem}>
            <Text style={tableStyles.summaryLabel}>Total distance</Text>
            <Text style={tableStyles.summaryValue}>{(totalMeters / 1000).toFixed(2)} km</Text>
          </View>
        </View>

        {/* Signature */}
        <View style={baseStyles.section}>
          <Text style={baseStyles.sectionTitle}>Pilot certification</Text>
          <Text>
            I hereby certify that the flights listed above are a true and accurate record of
            operations conducted under {spec.regulationRef}.
          </Text>
          <View style={baseStyles.signatureBox}>
            <Text style={baseStyles.signatureLabel}>
              Signature · {operator.pilotFirstName ?? "—"} {operator.pilotLastName ?? ""}
            </Text>
          </View>
        </View>

        <Text style={baseStyles.footer} fixed>
          Generated by ADOS Mission Control · {generatedAt.toISOString()} · {retentionLabel(spec.retentionMonths)}
        </Text>
      </Page>
    </Document>
  );
}
