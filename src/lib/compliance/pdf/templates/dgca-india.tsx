/**
 * DGCA India — Drone Rules 2021 single-flight report template.
 *
 * Audit-friendly layout: cover (regulator + reg ref), pilot block, aircraft
 * block, flight summary, signature, retention banner footer.
 *
 * @license GPL-3.0-only
 */

import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "../styles";
import { Row } from "../_shared/Row";
import type { FlightRecord, OperatorProfile, AircraftRecord } from "@/lib/types";

interface DgcaTemplateProps {
  record: FlightRecord;
  operator: OperatorProfile;
  aircraft: AircraftRecord | undefined;
  generatedAt: Date;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function DgcaIndiaTemplate({ record, operator, aircraft, generatedAt }: DgcaTemplateProps) {
  return (
    <Document title={`DGCA Flight Report ${record.id}`} author={operator.operatorName ?? "ADOS Mission Control"}>
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <View style={styles.cover}>
          <Text style={styles.brand}>Altnautica Mission Control · Compliance Export</Text>
          <Text style={styles.title}>DGCA Flight Record</Text>
          <Text style={styles.subtitle}>
            Drone Rules 2021 · DGCA CAR Section 3 Series X
          </Text>
        </View>

        {/* Pilot */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pilot</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Row label="First name" value={operator.pilotFirstName ?? record.pilotFirstName} />
              <Row label="Last name" value={operator.pilotLastName ?? record.pilotLastName} />
              <Row label="License (RPC) no." value={operator.pilotLicenseNumber ?? record.pilotLicenseNumber} />
              <Row label="License issuer" value={operator.pilotLicenseIssuer ?? record.pilotLicenseIssuer ?? "DGCA"} />
            </View>
            <View style={styles.col}>
              <Row label="License class" value={operator.pilotLicenseClass} />
              <Row label="License expiry" value={operator.pilotLicenseExpiry} />
              <Row label="Operator" value={operator.operatorName} />
              <Row label="Operator cert" value={operator.operatorCertNumber} />
            </View>
          </View>
        </View>

        {/* Aircraft */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aircraft</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Row label="Drone name" value={record.droneName} />
              <Row label="UIN / Reg" value={aircraft?.registrationNumber ?? record.aircraftRegistration} />
              <Row label="Manufacturer" value={aircraft?.manufacturer} />
              <Row label="Model" value={aircraft?.model} />
            </View>
            <View style={styles.col}>
              <Row label="Serial number" value={aircraft?.serialNumber ?? record.aircraftSerial} />
              <Row label="Vehicle type" value={aircraft?.vehicleType} />
              <Row label="Category" value={aircraft?.category} />
              <Row label="MTOM" value={aircraft?.mtomKg !== undefined ? `${aircraft.mtomKg} kg` : (record.aircraftMtomKg !== undefined ? `${record.aircraftMtomKg} kg` : undefined)} />
            </View>
          </View>
        </View>

        {/* Flight */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Flight</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Row label="Flight ID" value={record.id} />
              <Row label="Start (UTC)" value={fmtDateTime(record.startTime ?? record.date)} />
              <Row label="End (UTC)" value={fmtDateTime(record.endTime)} />
              <Row label="Duration" value={fmtDuration(record.duration)} />
              <Row label="Distance" value={`${(record.distance / 1000).toFixed(2)} km`} />
              <Row label="Suite / mission" value={record.suiteType} />
            </View>
            <View style={styles.col}>
              <Row label="Takeoff coords" value={fmtCoord(record.takeoffLat, record.takeoffLon)} />
              <Row label="Landing coords" value={fmtCoord(record.landingLat, record.landingLon)} />
              <Row label="Max altitude (AGL)" value={`${record.maxAlt} m`} />
              <Row label="Max speed" value={`${record.maxSpeed} m/s`} />
              <Row label="Battery used" value={`${record.batteryUsed}%`} />
              <Row label="Status" value={record.status} />
            </View>
          </View>
          {record.maxAlt > 120 && (
            <View style={styles.warningBox}>
              <Text>
                ⚠ Max altitude exceeded 120 m AGL. DGCA Drone Rules 2021 require an authorisation
                reference for operations above this limit. Add it to the flight notes before signing.
              </Text>
            </View>
          )}
        </View>

        {/* Signature */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pilot certification</Text>
          <Text>
            I hereby certify that the above record is a true and accurate account of the flight
            conducted under DGCA Drone Rules 2021.
          </Text>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>
              Signature · {operator.pilotFirstName ?? "—"} {operator.pilotLastName ?? ""}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Generated by ADOS Mission Control · {generatedAt.toISOString()} · Retain for 5 years per DGCA audit policy
        </Text>
      </Page>
    </Document>
  );
}
