import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toastSpy = vi.fn();

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { usePanelCommit, type PanelCommitSource } from "@/hooks/use-panel-commit";
import { IntlWrapper } from "../helpers/intl-wrapper";
import messages from "../../locales/en.json";

const m = messages.panelCommit;

function setup(overrides: Partial<PanelCommitSource> = {}) {
  const source = {
    saveAllToRam: vi.fn(async () => true),
    commitToFlash: vi.fn(async () => ({ sent: true, acknowledged: true })),
    revertAll: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => usePanelCommit(source), { wrapper: IntlWrapper });
  return { source, hook };
}

describe("usePanelCommit", () => {
  beforeEach(() => toastSpy.mockClear());

  it("reports a full save as saved and clears the saving flag", async () => {
    const { hook } = setup();
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.save();
    });
    expect(ok).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith(m.saved, "success");
    expect(hook.result.current.saving).toBe(false);
  });

  it("reports a partial save as a warning, never as saved", async () => {
    const { hook } = setup({ saveAllToRam: vi.fn(async () => false) });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(toastSpy).toHaveBeenCalledWith(m.partialSave, "warning");
    expect(toastSpy).not.toHaveBeenCalledWith(m.saved, "success");
  });

  it("holds the saving flag while the write is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const { hook } = setup({ saveAllToRam: vi.fn(() => promise) });
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = hook.result.current.save();
    });
    expect(hook.result.current.saving).toBe(true);
    await act(async () => {
      resolve(true);
      await pending;
    });
    expect(hook.result.current.saving).toBe(false);
  });

  it("never claims persistence for an unacknowledged flash commit", async () => {
    const { hook } = setup({
      commitToFlash: vi.fn(async () => ({ sent: true, acknowledged: false })),
    });
    await act(async () => {
      await hook.result.current.flash();
    });
    expect(toastSpy).toHaveBeenCalledWith(m.flashUnacknowledged, "warning");
  });

  it("reverts to the FC values and says so", () => {
    const { hook, source } = setup();
    act(() => hook.result.current.revert());
    expect(source.revertAll).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(m.reverted, "info");
  });
});
