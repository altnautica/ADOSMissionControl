/**
 * Flight logs list and a drone's Flights tab: statuses read as words, a
 * recording flight shows its elapsed time, a filtered-out or empty-trash list
 * says so, deletes ask through the app's confirm dialog, the stats strip
 * averages battery per flight, a drone's flight row opens that flight's log,
 * and demo history is seeded once for every view rather than by one page.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import messages from "../../locales/en.json";
import deMessages from "../../locales/de.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

let demo = false;
vi.mock("@/hooks/use-demo-mode", () => ({ useDemoMode: () => demo }));
// Demo telemetry lives in IndexedDB, which the test DOM does not have.
vi.mock("@/mock/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mock/history")>()),
  seedDemoTelemetryRecordings: async () => new Map<string, string>(),
}));

import { HistoryTable } from "@/components/history/HistoryTable";
import { HistoryBulkActions } from "@/components/history/HistoryBulkActions";
import { HistoryStatsBar } from "@/components/history/HistoryStatsBar";
import { LocalStoreHydrator } from "@/components/history/LocalStoreHydrator";
import { DroneFlightsTab } from "@/components/drone-detail/DroneFlightsTab";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightRecord } from "@/lib/types";

function wrap(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function flight(extra: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "f1",
    droneId: "d1",
    droneName: "Alpha",
    date: 0,
    startTime: 0,
    endTime: 0,
    duration: 0,
    distance: 0,
    maxAlt: 0,
    maxSpeed: 0,
    waypointCount: 0,
    status: "completed",
    updatedAt: 0,
    ...extra,
  };
}

const tableProps = {
  selectedId: null,
  onSelect: () => {},
  selectedIds: new Set<string>(),
  onToggleSelect: () => {},
  onSelectAllPage: () => {},
  sortKey: "date" as const,
  sortDir: "desc" as const,
  onSortChange: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  push.mockReset();
  demo = false;
});

describe("flight logs table", () => {
  it("shows the status as a word and a recording flight's elapsed time", () => {
    vi.useFakeTimers({ now: 100_000, toFake: ["Date", "setInterval", "clearInterval"] });
    wrap(
      <HistoryTable
        {...tableProps}
        records={[flight({ status: "in_progress", startTime: 100_000 - 75_000, duration: 0 })]}
      />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.queryByText("in_progress")).toBeNull();
    expect(screen.getByText("01:15")).toBeTruthy();
  });

  it("says no flight matches the filters and offers a reset", () => {
    const onResetFilters = vi.fn();
    wrap(<HistoryTable {...tableProps} records={[]} onResetFilters={onResetFilters} />);
    expect(screen.getByText("No flights match these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onResetFilters).toHaveBeenCalledOnce();
  });

  it("says the trash is empty in the trash view", () => {
    wrap(<HistoryTable {...tableProps} records={[]} trashMode onResetFilters={() => {}} />);
    expect(screen.getByText("Trash is empty")).toBeTruthy();
  });

  it("words the unknown-date row and dataflash marker in the operator's language", () => {
    render(
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <HistoryTable {...tableProps} records={[flight({ startTimeUnknown: true, source: "dataflash" })]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(deMessages.history.dateUnknown)).toBeTruthy();
    expect(screen.queryByText("Date unknown")).toBeNull();
    expect(screen.getByLabelText(deMessages.history.importedFromDataflash)).toBeTruthy();
  });
});

describe("bulk delete", () => {
  beforeEach(() => {
    useHistoryStore.setState({ records: [flight()] });
  });

  it("asks in the app's confirm dialog, not the browser's", () => {
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const removeRecord = vi.fn();
    useHistoryStore.setState({ removeRecord, persistToIDB: async () => {} });
    wrap(
      <HistoryBulkActions
        records={[flight()]}
        selectedIds={new Set(["f1"])}
        onClearSelection={() => {}}
        onSelect={() => {}}
        trashMode={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: messages.history.delete }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(removeRecord).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Move to trash")!,
    );
    expect(removeRecord).toHaveBeenCalledWith("f1");
  });
});

describe("stats strip", () => {
  it("averages battery per flight instead of adding percentages", () => {
    wrap(<HistoryStatsBar records={[flight({ batteryUsed: 40 }), flight({ id: "f2", batteryUsed: 60 })]} />);
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
  });
});

describe("drone flights tab", () => {
  it("opens the flight's log when its row is clicked, with a worded status", () => {
    useHistoryStore.setState({ records: [flight({ id: "flight-7", status: "emergency" })] });
    wrap(<DroneFlightsTab droneId="d1" />);
    expect(screen.getByText("Emergency")).toBeTruthy();
    fireEvent.click(screen.getByText("Emergency").closest("tr")!);
    expect(push).toHaveBeenCalledWith("/flight-logs?flight=flight-7");
  });
});

describe("demo history", () => {
  it("is seeded by the app-wide store loader, so every view sees it", async () => {
    demo = true;
    const reset = vi.fn(async () => {});
    const seed = vi.fn();
    useHistoryStore.setState({ ensureLoaded: async () => {}, resetDemoData: reset, initWithSeedData: seed });
    await act(async () => {
      wrap(<LocalStoreHydrator />);
    });
    await waitFor(() => expect(seed).toHaveBeenCalled());
    expect(reset).toHaveBeenCalled();
    expect(seed.mock.calls[0][0].length).toBeGreaterThan(1);
  });
});
