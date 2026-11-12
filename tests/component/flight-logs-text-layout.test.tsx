/**
 * @license GPL-3.0-only
 *
 * Flight logs text and layout: the detail header reads from the locale, the
 * status badge shows words rather than the stored enum, a named flight keeps
 * its date in the list, the stats strip wraps, and the plan library's sort
 * buttons stay inside a narrow panel.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../locales/en.json";
import deMessages from "../../locales/de.json";
import type { FlightRecord } from "@/lib/types";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/lib/telemetry-recorder", () => ({ listRecordings: () => Promise.resolve([]) }));
vi.mock("@/components/history/detail/tabs/OverviewTab", () => ({ OverviewTab: () => null }));

import { HistoryDetailPanel } from "@/components/history/detail/HistoryDetailPanel";
import { HistoryTable } from "@/components/history/HistoryTable";
import { HistoryStatsBar } from "@/components/history/HistoryStatsBar";
import { PlanSearchBar } from "@/components/library/PlanSearchBar";

function wrap(node: ReactNode, locale: "en" | "de" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : deMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function flight(extra: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "f1",
    droneId: "d1",
    droneName: "Alpha-01",
    date: Date.UTC(2026, 4, 3, 9, 30),
    duration: 600,
    status: "emergency",
    ...extra,
  } as FlightRecord;
}

describe("flight detail header", () => {
  it("renders tab names, actions and status from the active locale", () => {
    wrap(<HistoryDetailPanel record={flight()} onClose={() => {}} onToggleListCollapsed={() => {}} />, "de");
    const p = deMessages.history.historyDetailPanel;
    expect(screen.getByRole("tab", { name: p.tabs.overview })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: p.tabs.export })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(p.signAndLock) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: p.hideList })).toBeInTheDocument();
    expect(screen.getByText(p.flightDetail)).toBeInTheDocument();
    expect(screen.getByText(deMessages.history.emergency)).toBeInTheDocument();
    expect(screen.queryByText("emergency")).toBeNull();
  });
});

describe("flight list date cell", () => {
  it("shows a named flight's name and its date", () => {
    wrap(
      <HistoryTable
        records={[flight({ customName: "Survey north field", status: "completed" })]}
        selectedId={null}
        onSelect={() => {}}
        selectedIds={new Set()}
        onToggleSelect={() => {}}
        onSelectAllPage={() => {}}
        sortKey="date"
        sortDir="desc"
        onSortChange={() => {}}
      />,
    );
    const name = screen.getByText("Survey north field");
    const cell = name.closest("td");
    expect(cell?.textContent).toMatch(/2026/);
  });
});

describe("stats strip", () => {
  it("wraps rather than clipping on a narrow screen", () => {
    wrap(<HistoryStatsBar records={[flight({ batteryUsed: 40 })]} />);
    expect(screen.getByTestId("history-stats-bar").className).toMatch(/\bflex-wrap\b/);
  });
});

describe("plan library search bar", () => {
  it("lets the search field shrink so the sort buttons fit", () => {
    wrap(<PlanSearchBar />);
    const input = screen.getByRole("textbox");
    expect(input.className).toMatch(/\bmin-w-0\b/);
    expect(input.parentElement?.className).toMatch(/\bmin-w-0\b/);
  });
});
