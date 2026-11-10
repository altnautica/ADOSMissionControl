/**
 * The status pill's alert list, through the hook the pill renders: companion
 * storage warns at the shared 90 % and turns critical at 97 %, and critical
 * items sort first.
 *
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../locales/en.json";
import { usePillAlerts } from "@/components/cockpit/flight/StatusPill";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { AgentStatus } from "@/lib/agent/types";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function withDisk(pct: number | null): void {
  useAgentSystemStore.setState({
    status: (pct === null ? null : { health: { disk_percent: pct } }) as AgentStatus | null,
  });
}

function storageItems(droneId: string) {
  const { result } = renderHook(() => usePillAlerts(droneId), { wrapper });
  return result.current.filter((a) => a.source === "storage");
}

describe("usePillAlerts", () => {
  afterEach(() => {
    cleanup();
    withDisk(null);
  });

  it("lists nothing for storage below the warning line", () => {
    withDisk(89);
    expect(storageItems("drone-pill")).toEqual([]);
  });

  it("warns at 90 % used", () => {
    withDisk(90);
    const items = storageItems("drone-pill");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: "warning", text: "90 % used" });
  });

  it("is critical at 97 % used and sorts critical items first", () => {
    withDisk(97);
    const { result } = renderHook(() => usePillAlerts("drone-pill"), { wrapper });
    const storage = result.current.find((a) => a.source === "storage");
    expect(storage).toMatchObject({ severity: "critical", text: "97 % used" });
    const firstWarning = result.current.findIndex((a) => a.severity === "warning");
    const lastCritical = result.current.map((a) => a.severity).lastIndexOf("critical");
    expect(firstWarning === -1 || lastCritical < firstWarning).toBe(true);
  });

  it("warns that the pilot is not answering when a paired agent sent no pilot state", () => {
    useAgentConnectionStore.setState({ agentUrl: "http://agent.local:8080", consecutiveFailures: 0 });
    try {
      const { result } = renderHook(() => usePillAlerts("drone-pill"), { wrapper });
      expect(result.current.map((a) => a.id)).toContain("pilot_not_answering");
      useAgentConnectionStore.setState({ consecutiveFailures: 3 });
      const again = renderHook(() => usePillAlerts("drone-pill"), { wrapper });
      expect(again.result.current[0]).toMatchObject({ id: "agent_unreachable", severity: "critical" });
    } finally {
      useAgentConnectionStore.setState({ agentUrl: null, consecutiveFailures: 0 });
    }
  });
});
