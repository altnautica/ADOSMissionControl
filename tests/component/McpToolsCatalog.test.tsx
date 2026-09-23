/**
 * Smoke test for McpToolsCatalog: it renders the committed tool catalog grouped
 * by namespace with the honest "snapshot, not a live view" note (no fabricated reading).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import { McpToolsCatalog } from "@/components/mcp/McpToolsCatalog";
import catalog from "@/data/mcp/tools-catalog.json";

describe("McpToolsCatalog", () => {
  it("renders tools from the committed catalog with the honest snapshot caveat", () => {
    renderWithIntl(<McpToolsCatalog />);
    // a known tool from the catalog appears
    expect(screen.getByText("status.get")).toBeTruthy();
    // the honest "not a live view" note is present
    expect(screen.getByText(/not a live view/i)).toBeTruthy();
  });

  it("the committed catalog has tools across multiple namespaces", () => {
    const groups = new Set((catalog.tools as { group: string }[]).map((x) => x.group));
    expect(groups.size).toBeGreaterThan(3);
    expect(catalog.toolCount).toBe((catalog.tools as unknown[]).length);
  });
});
