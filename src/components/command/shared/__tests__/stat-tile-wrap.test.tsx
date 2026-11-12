/**
 * A word value in a stat tile wraps instead of truncating to "Unavail…".
 *
 * @license GPL-3.0-only
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "../StatTile";

describe("StatTile value", () => {
  it("wraps a word value", () => {
    render(<StatTile label="Video" value="Unavailable" wrapValue />);
    const value = screen.getByText("Unavailable");
    expect(value.className).not.toContain("truncate");
    expect(value.className).toContain("break-words");
  });

  it("keeps numbers on one line", () => {
    render(<StatTile label="CPU" value="24%" />);
    expect(screen.getByText("24%").className).toContain("truncate");
  });
});
