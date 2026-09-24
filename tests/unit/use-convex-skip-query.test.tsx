import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useQueryMock = vi.fn();
const useConvexAvailableMock = vi.fn(() => true);
const isDemoModeMock = vi.fn(() => false);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));
vi.mock("@/hooks/use-convex-available", () => ({
  useConvexAvailable: () => useConvexAvailableMock(),
}));
vi.mock("@/lib/utils", () => ({
  isDemoMode: () => isDemoModeMock(),
}));

import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

const dummyQuery = { _name: "cmdPlugins:listMine" } as never;

describe("useConvexSkipQuery", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useConvexAvailableMock.mockReset();
    useConvexAvailableMock.mockReturnValue(true);
    isDemoModeMock.mockReset();
    isDemoModeMock.mockReturnValue(false);
  });

  it("returns the query result when the query resolves cleanly", () => {
    useQueryMock.mockReturnValue([{ id: "abc" }]);
    const { result } = renderHook(() => useConvexSkipQuery(dummyQuery));
    expect(result.current).toEqual([{ id: "abc" }]);
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, {});
  });

  it("returns undefined and warns once when the server throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    useQueryMock.mockImplementation(() => {
      throw new Error(
        "[CONVEX Q(cmdPlugins:listMine)] Could not find public function for 'cmdPlugins:listMine'",
      );
    });

    const { result, rerender } = renderHook(() =>
      useConvexSkipQuery(dummyQuery),
    );
    expect(result.current).toBeUndefined();
    rerender();
    expect(result.current).toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "Could not find public function",
    );
    warnSpy.mockRestore();
  });

  it("re-throws when throwOnError is set", () => {
    useQueryMock.mockImplementation(() => {
      throw new Error("server boom");
    });
    expect(() =>
      renderHook(() =>
        useConvexSkipQuery(dummyQuery, { throwOnError: true }),
      ),
    ).toThrow("server boom");
  });

  it("passes 'skip' when convex is unavailable and never throws", () => {
    useConvexAvailableMock.mockReturnValue(false);
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useConvexSkipQuery(dummyQuery));
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, "skip");
    expect(result.current).toBeUndefined();
  });

  it("passes 'skip' in demo mode unless skipDemoCheck is true", () => {
    isDemoModeMock.mockReturnValue(true);
    useQueryMock.mockReturnValue(undefined);
    renderHook(() => useConvexSkipQuery(dummyQuery));
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, "skip");

    useQueryMock.mockClear();
    useQueryMock.mockReturnValue([1, 2, 3]);
    const { result } = renderHook(() =>
      useConvexSkipQuery(dummyQuery, { skipDemoCheck: true }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, {});
    expect(result.current).toEqual([1, 2, 3]);
  });

  it("passes 'skip' when enabled is false", () => {
    useQueryMock.mockReturnValue(undefined);
    renderHook(() =>
      useConvexSkipQuery(dummyQuery, { enabled: false }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, "skip");
  });

  it("forwards args when provided", () => {
    useQueryMock.mockReturnValue({ ok: true });
    const { result } = renderHook(() =>
      useConvexSkipQuery(dummyQuery, { args: { id: "x1" } as never }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(dummyQuery, { id: "x1" });
    expect(result.current).toEqual({ ok: true });
  });
});
