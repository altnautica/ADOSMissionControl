/**
 * @license GPL-3.0-only
 *
 * A drone's Flights list shows only its live flights; flights moved to Trash
 * stay out of the table and the count until restored.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { DroneFlightsTab } from "../DroneFlightsTab";

vi.mock("@/stores/history-store", () => ({
  useHistoryStore: (sel: (s: unknown) => unknown) =>
    sel({
      records: [
        { id: "a", droneId: "d1", date: 1, duration: 60, status: "completed" },
        { id: "b", droneId: "d1", date: 2, duration: 90, status: "completed", deleted: true },
        { id: "c", droneId: "d2", date: 3, duration: 30, status: "completed" },
      ],
    }),
}));

describe("DroneFlightsTab", () => {
  it("counts only the drone's flights that are not in Trash", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DroneFlightsTab droneId="d1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 flight recorded")).toBeInTheDocument();
  });
});
