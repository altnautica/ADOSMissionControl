/**
 * @license GPL-3.0-only
 *
 * FLOW_ORIENT_YAW keeps its fixed limits on every MC write path: the shared
 * write call, the Parameters grid and write confirmation, and file import,
 * with or without the vehicle's metadata.
 */

import { describe, it, expect, vi } from "vitest";
import { writeParamToFc } from "../param-write";
import { isParamValueRefused } from "../param-fixed-limits";
import { isValueOutOfRange as gridOutOfRange } from "@/components/fc/parameters/parameter-grid-utils";
import { isValueOutOfRange as confirmOutOfRange } from "@/components/fc/shared/WriteConfirmDialog";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

const documented = { range: { min: -17999, max: 18000 } } as Partial<ParamMetadata> as ParamMetadata;

describe("FLOW_ORIENT_YAW fixed limits", () => {
  it.each([1, 4, 7, 4505, -17999, 18010, 36000, 90.5])("refuses %d", (v) => {
    expect(isParamValueRefused("FLOW_ORIENT_YAW", v)).toBe(true);
    for (const meta of [documented, undefined]) {
      expect(gridOutOfRange(v, meta, "FLOW_ORIENT_YAW")).toBe(true);
      expect(confirmOutOfRange(v, meta, "FLOW_ORIENT_YAW")).toBe(true);
    }
  });

  it.each([0, 10, 9000, -9000, 18000, -17990])("accepts %d", (v) => {
    expect(isParamValueRefused("FLOW_ORIENT_YAW", v)).toBe(false);
    expect(gridOutOfRange(v, documented, "FLOW_ORIENT_YAW")).toBe(false);
  });

  it("leaves other parameters to their documented range", () => {
    expect(isParamValueRefused("FLOW_FXSCALER", 4)).toBe(false);
    expect(gridOutOfRange(4, undefined, "FLOW_FXSCALER")).toBe(false);
  });

  it("the shared write call never sends a refused value", async () => {
    const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    const result = await writeParamToFc({ writer: { setParameter }, name: "FLOW_ORIENT_YAW", value: 4, oldValue: 0, panelId: "parameters" });
    expect(result.success).toBe(false);
    expect(setParameter).not.toHaveBeenCalled();
  });
});
