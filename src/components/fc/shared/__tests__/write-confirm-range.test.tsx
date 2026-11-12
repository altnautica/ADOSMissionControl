/**
 * @license GPL-3.0-only
 *
 * The parameter write confirmation refuses a value outside the parameter's
 * documented range, and its text is localised.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import { WriteConfirmDialog } from "../WriteConfirmDialog";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

const META = new Map<string, ParamMetadata>([["WPNAV_SPEED", { range: { min: 10, max: 2000 } } as ParamMetadata]]);

describe("WriteConfirmDialog", () => {
  it("blocks a write with a value outside its range", () => {
    render(
      <WriteConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} metadata={META}
        changes={[{ name: "WPNAV_SPEED", oldValue: 500, newValue: 5000 }]} />,
      { wrapper: IntlWrapper },
    );
    expect(screen.getByText("1 parameter will be written to the flight controller.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Write 1 parameter/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Fix the values");
  });

  it("allows an in-range write", () => {
    render(
      <WriteConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} metadata={META}
        changes={[{ name: "WPNAV_SPEED", oldValue: 500, newValue: 600 }, { name: "X", oldValue: 0, newValue: 1 }]} />,
      { wrapper: IntlWrapper },
    );
    expect((screen.getByRole("button", { name: /Write 2 parameters/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
