/**
 * @license GPL-3.0-only
 *
 * Each item in the status pill's alert list carries the spec's severity
 * glyph (`chrome.severity_icon`), drawn in its severity colour.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import tokens from "@/lib/cockpit-spec/tokens.json";
import { PILL_SOURCES } from "@/lib/hud/status-pill";
import { StatusPillList } from "../StatusPillList";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

afterEach(cleanup);

describe("status pill list glyphs", () => {
  it("uses the spec glyph in the severity colour for every item", () => {
    const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
    renderWithIntl(
      <FlightGridContext.Provider value={grid}>
        <div className="ados-cockpit" data-testid="flight-screen">
          <StatusPillList
            listRef={{ current: null }}
            alerts={[
              { id: "a", source: PILL_SOURCES[0], severity: "critical", text: "Crit" },
              { id: "b", source: PILL_SOURCES[0], severity: "warning", text: "Warn" },
            ]}
          />
        </div>
      </FlightGridContext.Provider>,
    );
    const [crit, warn] = screen.getAllByTestId("status-pill-glyph");
    expect(crit.textContent).toBe(tokens.chrome.severity_icon.critical);
    expect(crit.style.color).toBe("var(--fs-crit)");
    expect(warn.textContent).toBe(tokens.chrome.severity_icon.warning);
    expect(warn.style.color).toBe("var(--fs-warn)");
  });
});
