/**
 * @license GPL-3.0-only
 *
 * Settings › General › Units is labelled for what it changes (the planner and
 * drawing tools), with a scope line, and no temperature unit it never applies.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { GeneralSection } from "../GeneralSection";

afterEach(cleanup);

describe("Planner units", () => {
  it("names its scope", () => {
    renderWithIntl(<GeneralSection />);
    expect(screen.getByText("Planner units")).toBeInTheDocument();
    expect(screen.getByText(/Applies to the mission planner/)).toBeInTheDocument();
    expect(screen.queryByText(/°C/)).toBeNull();
  });
});
