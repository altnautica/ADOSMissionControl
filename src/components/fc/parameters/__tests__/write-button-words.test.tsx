/**
 * @license GPL-3.0-only
 *
 * The parameter grid's write button uses the one verb every surface shares:
 * "Write {n} to flight controller", translated, never a hard-coded "Write to FC".
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";

import { ParameterSearchFilter } from "../ParameterSearchFilter";

const noop = vi.fn();

function renderBar(over: { saving?: boolean; modifiedCount?: number } = {}) {
  return renderWithIntl(
    <ParameterSearchFilter
      filter=""
      onFilterChange={noop}
      showModifiedOnly={false}
      onToggleModified={noop}
      showNonDefault={false}
      onToggleNonDefault={noop}
      showFavorites={false}
      onToggleFavorites={noop}
      paramCount={10}
      modifiedCount={over.modifiedCount ?? 3}
      loading={false}
      saving={over.saving ?? false}
      progress={{ current: 0, total: 0 }}
      writeProgress={{ current: 1, total: 3 }}
      onExport={noop}
      onCompare={noop}
      onDefaultsDiff={noop}
      onRevert={noop}
      onResetDefaults={noop}
      onSave={noop}
    />,
  );
}

describe("parameter write button words", () => {
  it("names the count and the flight controller", () => {
    renderBar();
    expect(screen.getByText(messages.fcShared.writeToFcCount.replace("{n}", "3"))).toBeTruthy();
    expect(screen.queryByText(/Write to FC \(/)).toBeNull();
  });

  it("shows translated progress while writing", () => {
    renderBar({ saving: true });
    expect(
      screen.getByText(messages.fcShared.writingProgress.replace("{current}", "1").replace("{total}", "3")),
    ).toBeTruthy();
  });
});
