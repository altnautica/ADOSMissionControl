/**
 * The shared forget-node hook exists so no unpair surface can skip the durable
 * Convex row delete — a cloud-paired node whose row survives re-feeds from the
 * reactive fleet query within a second and "unpair" silently does nothing.
 * These tests pin the wiring: the mutation handle rides along whenever Convex
 * is available, and never when it is not.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { mutationFn, forgetNodeMock, toastFn, convexState } = vi.hoisted(() => ({
  mutationFn: vi.fn(),
  forgetNodeMock: vi.fn(async (): Promise<{ ok: boolean; reason?: string; message?: string }> => ({ ok: true })),
  toastFn: vi.fn(),
  convexState: { available: true },
}));

vi.mock("convex/react", () => ({
  useMutation: () => mutationFn,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));
vi.mock("@/app/ConvexClientProvider", () => ({
  useConvexAvailable: () => convexState.available,
}));
vi.mock("@/lib/agent/forget-node", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agent/forget-node")>();
  return { ...actual, forgetNode: forgetNodeMock };
});

import { useForgetNode } from "@/hooks/use-forget-node";

beforeEach(() => {
  vi.clearAllMocks();
  convexState.available = true;
});

describe("useForgetNode", () => {
  it("threads the Convex unpair mutation when Convex is available", async () => {
    const { result } = renderHook(() => useForgetNode());

    await result.current("node:alpha", { convexId: "doc-1" });

    expect(forgetNodeMock).toHaveBeenCalledWith("node:alpha", {
      convexId: "doc-1",
      unpairMutation: mutationFn,
    });
  });

  it("passes no mutation when Convex is unavailable", async () => {
    convexState.available = false;
    const { result } = renderHook(() => useForgetNode());

    await result.current("node:alpha", { convexId: "doc-1" });

    expect(forgetNodeMock).toHaveBeenCalledWith("node:alpha", {
      convexId: "doc-1",
      unpairMutation: null,
    });
  });

  it("defaults a missing convexId to null for a purely local node", async () => {
    const { result } = renderHook(() => useForgetNode());

    await result.current("node:alpha");

    expect(forgetNodeMock).toHaveBeenCalledWith("node:alpha", {
      convexId: null,
      unpairMutation: mutationFn,
    });
  });

  it("reports a node the cloud would not release as an error, not a removal", async () => {
    forgetNodeMock.mockResolvedValueOnce({ ok: false, reason: "cloudFailed", message: "denied" });
    const { result } = renderHook(() => useForgetNode());

    const outcome = await result.current("node:alpha", { convexId: "doc-1" });

    expect(outcome.ok).toBe(false);
    expect(toastFn).toHaveBeenCalledWith("forgetCloudFailed", "error");
  });
});
