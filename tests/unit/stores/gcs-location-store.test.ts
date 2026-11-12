/**
 * Operator position on a desktop without a position provider reports
 * "unavailable" rather than "not requested".
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { useGcsLocationStore } from "@/stores/gcs-location-store";

function failWith(code: number) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, fail: (e: { code: number; message: string }) => void) =>
        fail({ code, message: "Network location provider returned error code 403" }),
    },
  });
}

function setPlatform(platform: "linux" | "darwin" | null) {
  (window as unknown as { electronAPI?: unknown }).electronAPI =
    platform === null ? undefined : { isElectron: true, platform };
}

afterEach(() => {
  setPlatform(null);
  useGcsLocationStore.setState({ permission: "prompt", lastError: null });
  vi.restoreAllMocks();
});

describe("requestPermission", () => {
  it("is unavailable when the Linux desktop has no position provider", async () => {
    setPlatform("linux");
    failWith(2);
    expect(await useGcsLocationStore.getState().requestPermission()).toBe("unavailable");
    expect(useGcsLocationStore.getState().permission).toBe("unavailable");
  });

  it("stays retryable for a transient failure elsewhere", async () => {
    setPlatform("darwin");
    failWith(2);
    expect(await useGcsLocationStore.getState().requestPermission()).toBe("prompt");
  });

  it("is denied when the operator refuses", async () => {
    setPlatform("linux");
    failWith(1);
    expect(await useGcsLocationStore.getState().requestPermission()).toBe("denied");
  });
});
