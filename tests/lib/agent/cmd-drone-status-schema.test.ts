/**
 * The cmd_droneStatus table and the pushStatus args agree on the local-display
 * and on-board video fields the agent heartbeat carries, asserted against the
 * runtime validators rather than the source text: a field declared on the
 * mutation but missing from the table (or typed differently) is a column the
 * deployment rejects at write time.
 */
import { describe, expect, it } from "vitest";

import schema from "../../../convex/schema";
import { pushStatusArgs } from "../../../convex/cmdDroneStatus";

const FIELD_KIND = {
  lcdActivePage: "string",
  lcdTouchCalibrated: "boolean",
  lcdRotation: "number",
  lcdSnapshotUrl: "string",
  lcdLastTouchAt: "number",
  lcdLastGesture: "string",
  videoLocalDecoderActive: "boolean",
  videoLocalDecoderType: "string",
  videoLocalDecoderFps: "number",
  videoRecording: "boolean",
  uiTheme: "string",
} as const;

interface ExportedField {
  fieldType: { type: string };
  optional: boolean;
}

interface ExportedTable {
  indexes: Array<{ indexDescriptor: string; fields: string[] }>;
  documentType: { type: string; value: Record<string, ExportedField> };
}

/** The table as Convex pushes it on deploy (`export()` is not in the public type). */
function exportTable(definition: unknown): ExportedTable {
  if (
    typeof definition !== "object" ||
    definition === null ||
    !("export" in definition) ||
    typeof definition.export !== "function"
  ) {
    throw new Error("cmd_droneStatus is not a Convex table definition");
  }
  const exported: ExportedTable = definition.export();
  return exported;
}

const table = exportTable(schema.tables.cmd_droneStatus);
const columns = table.documentType.value;

describe("cmd_droneStatus schema", () => {
  it("is indexed by device id", () => {
    expect(table.indexes).toContainEqual(
      expect.objectContaining({ indexDescriptor: "by_deviceId", fields: ["deviceId"] }),
    );
  });

  it.each(Object.entries(FIELD_KIND))(
    "stores %s as an optional %s on both the table and the mutation",
    (field, kind) => {
      expect(columns[field]).toEqual({ fieldType: { type: kind }, optional: true });
      const arg = pushStatusArgs[field as keyof typeof pushStatusArgs];
      // A numeric validator reports `float64` on the arg and `number` once exported.
      expect(arg.kind).toBe(kind === "number" ? "float64" : kind);
      expect(arg.isOptional).toBe("optional");
    },
  );

  it("requires the identifier fields on every row", () => {
    for (const field of ["deviceId", "version", "uptimeSeconds", "updatedAt"]) {
      expect(columns[field]?.optional, field).toBe(false);
    }
    expect(columns.radio?.fieldType.type).toBe("object");
  });
});
