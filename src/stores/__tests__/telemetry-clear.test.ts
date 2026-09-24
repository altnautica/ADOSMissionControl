/**
 * @license GPL-3.0-only
 *
 * Surfaces that select only `_version` and read the rings through getState()
 * must learn about a reset: after a drone switch or removal they would
 * otherwise keep drawing the previous drone's last sample.
 */

import { describe, it, expect } from "vitest";

import { useTelemetryStore } from "../telemetry-store";

describe("telemetry-store clear", () => {
  it("notifies _version subscribers once", () => {
    const seen: number[] = [];
    const unsubscribe = useTelemetryStore.subscribe((s, prev) => {
      if (s._version !== prev._version) seen.push(s._version);
    });

    useTelemetryStore.getState().clear();
    unsubscribe();

    expect(seen).toHaveLength(1);
  });
});
