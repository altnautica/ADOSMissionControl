/**
 * @license GPL-3.0-only
 *
 * A long range ("-0.1745 .. 0.1745") stays inside its column: the cell clips
 * with an ellipsis and carries the full range as a tooltip.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 32,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 32, size: 32, key: index })),
    measureElement: () => {},
  }),
}));

import { ParameterGrid } from "../ParameterGrid";

describe("ParameterGrid range column", () => {
  it("clips a long range and keeps it in a tooltip", () => {
    const meta = new Map<string, ParamMetadata>([["AHRS_TRIM_X", { range: { min: -0.1745, max: 0.1745 }, units: "rad" } as ParamMetadata]]);
    render(
      <ParameterGrid
        parameters={[{ name: "AHRS_TRIM_X", value: 0, type: 9, index: 0, count: 1 }]}
        modified={new Map()}
        onModify={vi.fn()}
        filter=""
        showModifiedOnly={false}
        metadata={meta}
        columnVisibility={{ index: true, name: true, description: true, value: true, options: true, range: true, units: true, type: true } as never}
      />,
      { wrapper: IntlWrapper },
    );
    const cell = screen.getByTestId("param-range-cell");
    expect(cell.className).toContain("truncate");
    expect(cell.className).toContain("min-w-0");
    expect(cell.getAttribute("title")).toBe("-0.1745 .. 0.1745");
  });
});
