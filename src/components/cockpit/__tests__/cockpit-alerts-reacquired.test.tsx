/**
 * The follow-me re-acquired advisory: raised once per `follow.reacquired`
 * event, worded from the event, and gone after 4 s.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../locales/en.json";
import { CockpitAlerts, REACQUIRED_ADVISORY_MS } from "@/components/cockpit/CockpitAlerts";
import { specString } from "@/lib/cockpit/spec-strings";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "node:d1";

function renderAlerts() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitAlerts droneId={DRONE} />
    </NextIntlClientProvider>,
  );
}

const advisory = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-testid='cockpit-alert-reacquired']");

describe("CockpitAlerts re-acquired advisory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNavStreamStore.getState().clear(DRONE);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the re-acquired advisory for 4 s", () => {
    const { container } = renderAlerts();
    expect(advisory(container)).toBeNull();
    act(() => {
      useNavStreamStore
        .getState()
        .pushFollowEvent(DRONE, { topic: "follow.reacquired", trackId: 15, similarity: 0.862, gapS: 1.8 });
    });
    const el = advisory(container)!;
    expect(el.getAttribute("data-level")).toBe("advisory");
    expect(el.textContent).toContain(specString("follow.reacquired_toast", { id: 15, sim: "0.86", gap: "1.8" }));

    act(() => {
      vi.advanceTimersByTime(REACQUIRED_ADVISORY_MS + 50);
    });
    expect(advisory(container)).toBeNull();
  });

  it("does not raise an advisory for a lost event or an old event", () => {
    act(() => {
      useNavStreamStore
        .getState()
        .pushFollowEvent(DRONE, { topic: "follow.reacquired", trackId: 15, similarity: 0.9, gapS: 1 }, Date.now() - 10_000);
    });
    const { container } = renderAlerts();
    expect(advisory(container)).toBeNull();
    act(() => {
      useNavStreamStore.getState().pushFollowEvent(DRONE, { topic: "follow.lost", trackId: 15, reason: "lock_lost" });
    });
    expect(advisory(container)).toBeNull();
  });
});
