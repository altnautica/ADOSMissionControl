import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const toastSpy = vi.fn();

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";

const ACKED = { sent: true, acknowledged: true } as const;
const UNACKED = { sent: true, acknowledged: false } as const;
const NOT_SENT = { sent: false, acknowledged: false } as const;

describe("useFlashCommitToast", () => {
  it("fires the default success toast for an acknowledged commit", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(ACKED);
    expect(toastSpy).toHaveBeenCalledWith(
      "Written to flash — persists after reboot",
      "success",
    );
  });

  it("never claims persistence for a commit the vehicle did not acknowledge", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(UNACKED);
    expect(toastSpy).toHaveBeenCalledWith(
      "Flash commit sent — vehicle did not acknowledge it",
      "warning",
    );
  });

  it("fires the default error toast when the commit never left the GCS", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(NOT_SENT);
    expect(toastSpy).toHaveBeenCalledWith("Failed to write to flash", "error");
  });

  it("respects a custom successMessage override", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(ACKED, { successMessage: "Saved to flash" });
    expect(toastSpy).toHaveBeenCalledWith("Saved to flash", "success");
  });

  it("respects a custom errorMessage override", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(NOT_SENT, { errorMessage: "Commit rejected" });
    expect(toastSpy).toHaveBeenCalledWith("Commit rejected", "error");
  });

  it("does not let a successMessage override mask an unacknowledged commit", () => {
    toastSpy.mockClear();
    const { result } = renderHook(() => useFlashCommitToast());
    result.current.showFlashResult(UNACKED, { successMessage: "Saved to flash" });
    expect(toastSpy).toHaveBeenCalledWith(
      "Flash commit sent — vehicle did not acknowledge it",
      "warning",
    );
  });

  it("returns a stable callback across re-renders", () => {
    toastSpy.mockClear();
    const { result, rerender } = renderHook(() => useFlashCommitToast());
    const first = result.current.showFlashResult;
    rerender();
    expect(result.current.showFlashResult).toBe(first);
  });
});
