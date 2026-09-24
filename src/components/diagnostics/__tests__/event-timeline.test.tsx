/**
 * @license GPL-3.0-only
 *
 * The event timeline shows events logged while it is open. The store mutates
 * the timeline buffer in place, so the view must follow the logged events,
 * not the (unchanging) buffer reference.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { EventTimeline } from "../EventTimeline";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";

describe("EventTimeline", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clear();
  });

  it("shows an event logged after it mounted", async () => {
    render(<EventTimeline />);
    expect(screen.getByText("No events recorded")).toBeInTheDocument();

    await act(async () => {
      useDiagnosticsStore.getState().logEvent("arm", "Vehicle armed");
      // The store coalesces its version bump to the next frame.
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });

    expect(screen.getByText("Vehicle armed")).toBeInTheDocument();
  });
});
