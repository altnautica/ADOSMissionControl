/**
 * @license GPL-3.0-only
 *
 * The Reports back control is one link, not a button nested in a link.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../locales/en.json";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import ReportsPage from "../page";

describe("ReportsPage back control", () => {
  it("is a single link with no nested button", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReportsPage />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole("link", { name: messages.history.title });
    expect(link.getAttribute("href")).toBe("/flight-logs");
    expect(link.querySelector("button")).toBeNull();
  });
});
