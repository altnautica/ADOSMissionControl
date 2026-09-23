/**
 * @module fc/pid/pid-param-row.test
 * @description A PID gain the flight controller did not report is not a live
 * 0: the row says so and cannot be edited.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PidParamRow } from "../PidAxisRow";

const pidP = { param: "ACRO_RP_RATE", label: "ACRO Roll/Pitch Rate", min: 1, max: 1080, step: 1 };

function renderRow(value: number | undefined, hasLoaded: boolean) {
  const onChange = vi.fn();
  render(
    <PidParamRow pidP={pidP} value={value} hasLoaded={hasLoaded} isDirty={false}
      onChange={onChange} name={null} gridClass="grid-cols-3" />,
  );
  return onChange;
}

describe("PidParamRow", () => {
  it("shows an absent param as not on this firmware, with no value and no slider", () => {
    renderRow(undefined, true);
    expect(screen.getByText("Not on this firmware")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.disabled).toBe(true);
  });

  it("shows an unread param as not read", () => {
    renderRow(undefined, false);
    expect(screen.getByText("Not read")).toBeTruthy();
  });

  it("renders a reported value as an editable slider", () => {
    renderRow(360, true);
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("360");
    expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(false);
  });
});
