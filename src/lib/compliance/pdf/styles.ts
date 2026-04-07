/**
 * Shared @react-pdf/renderer styles for compliance templates.
 *
 * Light-theme PDF (audit-friendly), monospace data, sans-serif copy.
 *
 * @license GPL-3.0-only
 */

import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#0a0a0f",
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  cover: {
    borderBottom: "2 solid #0a0a0f",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brand: {
    fontSize: 8,
    color: "#6b6b7f",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 10,
    color: "#3f3f54",
    marginTop: 2,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#6b6b7f",
    borderBottom: "1 solid #d5d5e0",
    paddingBottom: 2,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 2,
  },
  rowLabel: {
    width: 130,
    color: "#6b6b7f",
  },
  rowValue: {
    flex: 1,
    color: "#0a0a0f",
    fontFamily: "Courier",
  },
  twoCol: {
    flexDirection: "row",
    gap: 24,
  },
  col: {
    flex: 1,
  },
  signatureBox: {
    marginTop: 24,
    borderTop: "1 solid #0a0a0f",
    paddingTop: 4,
    width: 200,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#6b6b7f",
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#6b6b7f",
    textAlign: "center",
    borderTop: "1 solid #d5d5e0",
    paddingTop: 4,
  },
  warningBox: {
    marginTop: 8,
    padding: 6,
    backgroundColor: "#fff7e6",
    border: "1 solid #f59e0b",
    fontSize: 8,
  },
});
