/**
 * @module hooks/use-shell-modals-allowed.test
 * @description A vehicle last known armed keeps holding the shell modals for
 * the link-lost window when its transport closes (the registry detaches its
 * FC and it has no arm state), not only when its link reads "unknown"; a
 * disarmed report releases the hold at once.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { ARMED_LINK_LOST_HOLD_MS, useShellModalsAllowed } from "@/hooks/use-shell-modals-allowed";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";

const ID = "node:shell-hold";

/** Report an arm state, then let the registry's coalesced FC notification land. */
function armed(armState: "armed" | "disarmed"): void {
  const registry = useNodeRegistryStore.getState();
  registry.upsertPresence(ID, { name: "Shell hold" }, "local");
  registry.attachFc(ID, ID);
  registry.updateFcTelemetry(ID, { armState, lastHeartbeat: Date.now() });
  vi.advanceTimersByTime(50);
}

describe("useShellModalsAllowed after a transport close", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFlightScreenStore.setState({ mounted: 0 });
  });
  afterEach(() => {
    cleanup();
    useNodeRegistryStore.getState().clear();
    vi.useRealTimers();
  });

  it("holds for the link-lost window when an armed vehicle's FC is detached", () => {
    armed("armed");
    const { result } = renderHook(() => useShellModalsAllowed());
    expect(result.current).toBe(false);

    act(() => useNodeRegistryStore.getState().detachFc(ID));
    expect(useNodeRegistryStore.getState().nodes[ID]?.fc.armState).toBeUndefined();
    act(() => void vi.advanceTimersByTime(ARMED_LINK_LOST_HOLD_MS - 1000));
    expect(result.current).toBe(false);

    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);
  });

  it("releases at once when the vehicle reports disarmed", () => {
    armed("armed");
    const { result } = renderHook(() => useShellModalsAllowed());
    act(() => armed("disarmed"));
    act(() => useNodeRegistryStore.getState().detachFc(ID));
    expect(result.current).toBe(true);
  });
});
