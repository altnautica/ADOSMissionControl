import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, isDemoMode: () => true };
});

import { gimbalRateAvailable, postGimbalRate } from "@/lib/cockpit/gimbal-rate";

describe("gimbal rate in demo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers without any network request", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in demo")));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await gimbalRateAvailable("alpha-1")).toBe(true);
    expect(await postGimbalRate("alpha-1", 10, 0)).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers no rates for a drone with no companion agent", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in demo")));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await gimbalRateAvailable("bravo-2")).toBe(false);
    expect(await postGimbalRate("bravo-2", 10, 0)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
