/**
 * @license GPL-3.0-only
 *
 * Logs › Events (PX4) reads in the operator's language: empty texts and
 * severity labels come from locale keys, and each row shows its receive time.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import de from "../../../../locales/de.json";
import { usePx4EventsStore } from "@/stores/px4-events-store";
import { Px4EventsFeed } from "../Px4EventsFeed";

function renderDe() {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <Px4EventsFeed />
    </NextIntlClientProvider>,
  );
}

describe("Px4EventsFeed · locale", () => {
  beforeEach(() => usePx4EventsStore.setState({ events: [] }));

  it("shows the empty text in German", () => {
    renderDe();
    expect(screen.getByText(de.droneDetail.px4EventsFeed.emptyNone)).toBeInTheDocument();
  });

  it("labels severity from locale keys and shows the receive time", () => {
    const receivedAt = Date.UTC(2026, 0, 1, 13, 4, 5);
    usePx4EventsStore.setState({
      events: [{ key: 1, name: "commander_arm_denied", text: "Arming denied", severity: 3, timeBootMs: 0, receivedAt } as never],
    });
    renderDe();
    expect(screen.getByLabelText(de.droneDetail.px4EventsFeed.severity.error)).toBeInTheDocument();
    expect(screen.getByText("13:04:05")).toBeInTheDocument();
  });
});
