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
    expect(await gimbalRateAvailable("demo-1")).toBe(true);
    expect(await postGimbalRate("demo-1", 10, 0)).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
