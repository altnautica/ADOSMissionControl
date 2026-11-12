/**
 * @module ui/badge.test
 * @description The shared badge is an outline chip in sentence case: a tinted
 * hairline and coloured text on no fill, never upper-cased or letter-spaced.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "../badge";

afterEach(cleanup);

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe("Badge", () => {
  it("draws an outline in sentence case", () => {
    render(<Badge variant="success">Armed</Badge>);
    const c = classes(screen.getByText("Armed"));
    expect(c).toEqual(
      expect.arrayContaining([
        "border",
        "bg-transparent",
        "rounded-[4px]",
        "border-status-success/40",
        "text-status-success",
      ]),
    );
    expect(c).not.toContain("uppercase");
    expect(c).not.toContain("tracking-wider");
    expect(c.some((x) => x.startsWith("bg-status-"))).toBe(false);
  });

  it("uses the fixed heights for both sizes", () => {
    render(
      <>
        <Badge size="sm">Small</Badge>
        <Badge size="md">Medium</Badge>
      </>,
    );
    expect(classes(screen.getByText("Small"))).toEqual(
      expect.arrayContaining(["h-5", "px-1.5", "text-[11px]"]),
    );
    expect(classes(screen.getByText("Medium"))).toEqual(
      expect.arrayContaining(["h-6", "px-2", "text-xs"]),
    );
  });

  it("keeps the neutral tone on the default border", () => {
    render(<Badge>Idle</Badge>);
    expect(classes(screen.getByText("Idle"))).toEqual(
      expect.arrayContaining(["border-border-default", "text-text-secondary"]),
    );
  });
});
