/**
 * MAV_PARAM_TYPE values as defined in MAVLink common.xml, and the iNav
 * setting-type mapping that feeds the Parameters grid's type column.
 */

import { describe, it, expect } from "vitest";
import { MAV_PARAM_TYPE, MAV_PARAM_TYPE_LABELS } from "@/lib/protocol/param-value-codec";
import { inavTypeToMavType } from "@/lib/protocol/msp-adapter-params";

describe("MAV_PARAM_TYPE", () => {
  it("labels every wire value with its common.xml name", () => {
    expect(MAV_PARAM_TYPE_LABELS).toEqual({
      1: "UINT8", 2: "INT8", 3: "UINT16", 4: "INT16", 5: "UINT32",
      6: "INT32", 7: "UINT64", 8: "INT64", 9: "REAL32", 10: "REAL64",
    });
  });

  it("maps iNav setting types onto the matching MAVLink types", () => {
    expect([0, 1, 2, 3, 4, 5].map(inavTypeToMavType)).toEqual([
      MAV_PARAM_TYPE.UINT8,
      MAV_PARAM_TYPE.INT8,
      MAV_PARAM_TYPE.UINT16,
      MAV_PARAM_TYPE.INT16,
      MAV_PARAM_TYPE.UINT32,
      MAV_PARAM_TYPE.REAL32,
    ]);
    expect(inavTypeToMavType(5)).toBe(9);
  });
});
