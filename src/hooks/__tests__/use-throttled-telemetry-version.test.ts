import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";

function bump() {
  useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
}

describe("useThrottledTelemetryVersion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTelemetryStore.setState({ _version: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes at most once per interval and keeps the trailing value", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useThrottledTelemetryVersion(250);
    });
    expect(result.current).toBe(0);
    const baseline = renders;

    // 20 bumps inside one window: nothing published before the window ends.
    act(() => {
      for (let i = 0; i < 20; i++) bump();
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe(20);
    expect(renders - baseline).toBe(1);
  });

  it("publishes immediately after a quiet period", () => {
    const { result } = renderHook(() => useThrottledTelemetryVersion(250));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => bump());
    expect(result.current).toBe(1);
  });

  it("stops publishing after unmount", () => {
    const { result, unmount } = renderHook(() => useThrottledTelemetryVersion(250));
    unmount();
    act(() => {
      bump();
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(0);
  });
});
