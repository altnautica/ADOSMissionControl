/**
 * @module pdf/flight-brief-document
 * @description `@react-pdf/renderer` document for a one-page mission flight
 * brief. Renders the plan summary (name, drone, waypoint count, total distance,
 * estimated duration, altitude range) and a waypoint table (seq / lat / lon /
 * alt / altitude frame / command). Props are plain, pre-computed data — this component performs
 * no store access, no I/O, and no mission math. It is a print document, so the
 * neutral dark-on-light palette below is intentional and the app's design-token
 * rule does not apply here.
 * @license GPL-3.0-only
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { AltitudeFrame } from "@/lib/types";

/** One waypoint row in the brief table (plain, display-ready numbers). */
export interface BriefWaypointRow {
  seq: number;
  lat: number;
  lon: number;
  alt: number;
  /** The frame `alt` is measured in; rows of one mission can differ. */
  frame: AltitudeFrame;
  command: string;
}

/** What each altitude frame measures from, as printed in the brief. */
export const FRAME_LABEL: Record<AltitudeFrame, string> = {
  relative: "Rel. home",
  absolute: "MSL",
  terrain: "Above terrain",
};

/** Pre-computed plan statistics shown in the brief header block. */
export interface BriefStats {
  /** Total 3D path distance in meters. */
  distanceM: number;
  /** Estimated flight duration in seconds. */
  durationS: number;
  /** Lowest waypoint altitude (m), within `altFrame`. */
  altMin: number;
  /** Highest waypoint altitude (m), within `altFrame`. */
  altMax: number;
  /** The one frame every altitude is in, or "mixed" when the rows differ (a
   * range across frames compares unlike numbers, so none is printed). */
  altFrame: AltitudeFrame | "mixed" | null;
  /** DO_JUMP repeats are not in the duration or distance estimate. */
  excludesJumpRepeats: boolean;
}

export interface FlightBriefDocumentProps {
  /** Mission name (already trimmed / defaulted by the caller). */
  name: string;
  /** Target drone display name, when a drone is selected. */
  droneName?: string;
  /** Generation timestamp (epoch ms). */
  generatedAt: number;
  /** Waypoint rows; empty renders an honest "no waypoints" note. */
  waypoints: BriefWaypointRow[];
  /** Summary statistics for the header block. */
  stats: BriefStats;
}

const COLORS = {
  ink: "#111827",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  headBg: "#f3f4f6",
  zebra: "#fafafa",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
    fontSize: 9,
    color: COLORS.ink,
    fontFamily: "Helvetica",
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 10,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: COLORS.faint,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  subLine: {
    fontSize: 9,
    color: COLORS.muted,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
  },
  metaCell: {
    width: "33.33%",
    marginBottom: 10,
    paddingRight: 8,
  },
  metaLabel: {
    fontSize: 7.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.faint,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 2,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  trLast: {
    borderBottomWidth: 0,
  },
  trHead: {
    backgroundColor: COLORS.headBg,
  },
  trZebra: {
    backgroundColor: COLORS.zebra,
  },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 8.5,
  },
  cellHead: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  colSeq: { width: "8%" },
  colLat: { width: "20%" },
  colLon: { width: "20%" },
  colAlt: { width: "12%", textAlign: "right" },
  colFrame: { width: "16%", paddingLeft: 8 },
  colCmd: { width: "24%" },
  empty: {
    padding: 12,
    fontSize: 9,
    color: COLORS.muted,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: COLORS.faint,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

/** Distance in km (≥1 km) or rounded meters. */
function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

/** Human-friendly duration (h/m/s), rounded to the second. */
function fmtDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtCoord(v: number): string {
  return v.toFixed(6);
}

function fmtAlt(v: number): string {
  return `${v.toFixed(1)} m`;
}

function fmtTimestamp(ms: number): string {
  const d = new Date(ms);
  // ISO-like, second precision, no locale surprises in the document.
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** One-page mission flight brief (text + table, no map image). */
export function FlightBriefDocument({
  name,
  droneName,
  generatedAt,
  waypoints,
  stats,
}: FlightBriefDocumentProps) {
  const altRange =
    waypoints.length === 0 || stats.altFrame === null
      ? "—"
      : stats.altFrame === "mixed"
        ? "Mixed frames, see table"
        : `${
            stats.altMin === stats.altMax
              ? fmtAlt(stats.altMin)
              : `${fmtAlt(stats.altMin)} – ${fmtAlt(stats.altMax)}`
          } ${FRAME_LABEL[stats.altFrame]}`;

  return (
    <Document title={`Flight Brief — ${name}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>ADOS Mission Control · Flight Brief</Text>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.subLine}>Generated {fmtTimestamp(generatedAt)}</Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Drone</Text>
            <Text style={styles.metaValue}>{droneName || "Not assigned"}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Waypoints</Text>
            <Text style={styles.metaValue}>{waypoints.length}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Total distance</Text>
            <Text style={styles.metaValue}>{fmtDistance(stats.distanceM)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Est. duration</Text>
            <Text style={styles.metaValue}>
              {fmtDuration(stats.durationS)}
              {stats.excludesJumpRepeats ? " (excl. DO_JUMP repeats)" : ""}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Altitude range</Text>
            <Text style={styles.metaValue}>{altRange}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Waypoints</Text>
        {waypoints.length === 0 ? (
          <View style={styles.table}>
            <Text style={styles.empty}>No waypoints in this plan.</Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.cell, styles.cellHead, styles.colSeq]}>#</Text>
              <Text style={[styles.cell, styles.cellHead, styles.colLat]}>Latitude</Text>
              <Text style={[styles.cell, styles.cellHead, styles.colLon]}>Longitude</Text>
              <Text style={[styles.cell, styles.cellHead, styles.colAlt]}>Alt</Text>
              <Text style={[styles.cell, styles.cellHead, styles.colFrame]}>Frame</Text>
              <Text style={[styles.cell, styles.cellHead, styles.colCmd]}>Command</Text>
            </View>
            {waypoints.map((wp, i) => {
              const isLast = i === waypoints.length - 1;
              const rowStyles = [
                styles.tr,
                ...(i % 2 === 1 ? [styles.trZebra] : []),
                ...(isLast ? [styles.trLast] : []),
              ];
              return (
                <View key={wp.seq} style={rowStyles} wrap={false}>
                  <Text style={[styles.cell, styles.colSeq]}>{wp.seq}</Text>
                  <Text style={[styles.cell, styles.colLat]}>{fmtCoord(wp.lat)}</Text>
                  <Text style={[styles.cell, styles.colLon]}>{fmtCoord(wp.lon)}</Text>
                  <Text style={[styles.cell, styles.colAlt]}>{fmtAlt(wp.alt)}</Text>
                  <Text style={[styles.cell, styles.colFrame]}>{FRAME_LABEL[wp.frame]}</Text>
                  <Text style={[styles.cell, styles.colCmd]}>{wp.command}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Altitudes are meters in the frame shown on each row. Distances are 3D path length.</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
