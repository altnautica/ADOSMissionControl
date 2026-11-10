/**
 * @module mock/demo-agent-unreachable-pill.test
 * @description Demo mode connects its agent under the focused drone's device
 * id, so `__adosDemo.failAgentPolls(n)` makes the status pill list the agent
 * as unreachable for the drone on screen, and an FC-only drone (no agent)
 * names no focused agent.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../locales/en.json";

vi.mock("@/components/layout/DemoMissionSync", () => ({ DemoMissionSync: () => null }));

import { DemoProvider } from "@/components/layout/DemoProvider";
import { usePillAlerts } from "@/components/cockpit/flight/StatusPill";
import { POLL_BASE_MS } from "@/stores/agent-connection/poll-backoff";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveNodeId } from "@/stores/node-registry";

const ALPHA = resolveNodeId("alpha-1");
const FC_ONLY = resolveNodeId("bravo-2");

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

async function startDemo(): Promise<void> {
  render(<DemoProvider />);
  // The engine and the demo agent client load lazily; then the agent connects.
  await act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("demo agent unreachable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("lists agent_unreachable for the focused demo drone after failed polls", async () => {
    await startDemo();
    act(() => useDroneManager.getState().selectDrone(ALPHA));
    expect(useAgentConnectionStore.getState().connected).toBe(true);
    expect(useAgentConnectionStore.getState().nodeDeviceId).toBe("alpha-1");

    await act(async () => {
      window.__adosDemo!.failAgentPolls(3);
      await vi.advanceTimersByTimeAsync(POLL_BASE_MS);
    });
    expect(useAgentConnectionStore.getState().consecutiveFailures).toBeGreaterThanOrEqual(3);
    const { result } = renderHook(() => usePillAlerts(ALPHA), { wrapper });
    expect(result.current.map((a) => a.id)).toContain("agent_unreachable");
  });

  it("names no focused agent for an FC-only demo drone", async () => {
    await startDemo();
    act(() => useDroneManager.getState().selectDrone(FC_ONLY));
    expect(useAgentConnectionStore.getState().nodeDeviceId).toBeNull();
  });
});
