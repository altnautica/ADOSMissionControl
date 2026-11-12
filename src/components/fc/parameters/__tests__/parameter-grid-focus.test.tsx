/**
 * @license GPL-3.0-only
 *
 * A parameter opened from the command palette lands on its exact row:
 * "RTL_ALT" highlights and scrolls to RTL_ALT, not RTL_ALT_FINAL.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const scrollToIndex = vi.fn();
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 32,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 32, size: 32, key: index })),
    measureElement: () => {},
    scrollToIndex,
  }),
}));

import { ParameterGrid } from "../ParameterGrid";

describe("ParameterGrid focusParam", () => {
  it("highlights and scrolls to the exact name", () => {
    render(
      <ParameterGrid
        parameters={[
          { name: "RTL_ALT_FINAL", value: 0, type: 9, index: 0, count: 2 },
          { name: "RTL_ALT", value: 1500, type: 9, index: 1, count: 2 },
        ]}
        modified={new Map()}
        onModify={vi.fn()}
        filter="RTL_ALT"
        showModifiedOnly={false}
        focusParam="RTL_ALT"
        columnVisibility={{ index: true, name: true, description: true, value: true, options: true, range: true, units: true, type: true } as never}
      />,
      { wrapper: IntlWrapper },
    );
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("RTL_ALT");
    expect(current[0].textContent).not.toContain("RTL_ALT_FINAL");
    const rows = screen.getAllByText(/^RTL_ALT/);
    expect(rows.length).toBe(2);
    expect(scrollToIndex).toHaveBeenCalled();
  });
});
