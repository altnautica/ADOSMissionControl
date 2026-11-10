/**
 * The status pill's alert list, through the hook the pill renders: companion
 * storage warns at the shared 90 % and turns critical at 97 %, critical
 * items sort first, the pilot and agent items speak only for a drone paired
 * with an agent, a pilot state ages out at 2 s, and a frozen video reads as
 * the video source.
 *
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../locales/en.json";
import { usePillAlerts } from "@/components/cockpit/flight/StatusPill";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useVideoStore } from "@/stores/video-store";
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

/** The focused agent is node `deviceId`. */
function pairAgent(deviceId: string, failures = 0): void {
  useAgentConnectionStore.setState({ agentUrl: "http://agent.local:8080", nodeDeviceId: deviceId, consecutiveFailures: failures });
}

const PILOT_ITEMS = ["pilot_not_answering", "agent_unreachable"];

describe("usePillAlerts", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    withDisk(null);
    useAgentConnectionStore.setState({ agentUrl: null, nodeDeviceId: null, consecutiveFailures: 0 });
    useNodeRegistryStore.getState().clear();
    useNavStreamStore.getState().clear("node:pill");
    useVideoStore.setState({ isStreaming: false, degradedReason: null });
    useDroneManager.setState({ selectedDroneId: null });
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

  it("is critical at 97 % used", () => {
    withDisk(97);
    expect(storageItems("drone-pill")[0]).toMatchObject({ severity: "critical", text: "97 % used" });
  });

  it("sorts a critical item ahead of a warning from this surface's own rules", () => {
    useDroneManager.setState({ selectedDroneId: "drone-pill" });
    useVideoStore.setState({ isStreaming: true, degradedReason: "no-progress" });
    withDisk(97);
    const { result } = renderHook(() => usePillAlerts("drone-pill"), { wrapper });
    const ids = result.current.map((a) => a.id);
    const video = ids.findIndex((id) => id.startsWith("alert:videoFrozen"));
    const storage = result.current.findIndex((a) => a.source === "storage");
    expect(video).toBeGreaterThanOrEqual(0);
    expect(storage).toBeGreaterThanOrEqual(0);
    expect(result.current[storage].severity).toBe("critical");
    expect(result.current[video].severity).toBe("warning");
    expect(storage).toBeLessThan(video);
  });

  it("lists a frozen video under the video source", () => {
    useDroneManager.setState({ selectedDroneId: "drone-pill" });
    useVideoStore.setState({ isStreaming: true, degradedReason: "ice-disconnect" });
    const { result } = renderHook(() => usePillAlerts("drone-pill"), { wrapper });
    expect(result.current.find((a) => a.id.startsWith("alert:videoFrozen"))?.source).toBe("video");
  });

  it("warns that the pilot is not answering when this drone's agent sent no pilot state", () => {
    pairAgent("pill");
    const { result } = renderHook(() => usePillAlerts("node:pill"), { wrapper });
    expect(result.current.map((a) => a.id)).toContain("pilot_not_answering");
    useAgentConnectionStore.setState({ consecutiveFailures: 3 });
    const again = renderHook(() => usePillAlerts("node:pill"), { wrapper });
    expect(again.result.current[0]).toMatchObject({ id: "agent_unreachable", severity: "critical" });
  });

  it("lists no pilot or agent item for a direct flight controller while another node's agent is paired", () => {
    pairAgent("A", 3);
    const { result } = renderHook(() => usePillAlerts("fc:B"), { wrapper });
    expect(result.current.map((a) => a.id).filter((id) => PILOT_ITEMS.includes(id))).toEqual([]);
  });

  it("expects a pilot from a drone whose registry row runs an agent, without the focused node's reachability", () => {
    pairAgent("A", 3);
    useNodeRegistryStore.getState().upsertPresence("node:C", { deviceId: "C", name: "C", agentIdentityKnown: true }, "local");
    const { result } = renderHook(() => usePillAlerts("node:C"), { wrapper });
    const ids = result.current.map((a) => a.id);
    expect(ids).toContain("pilot_not_answering");
    expect(ids).not.toContain("agent_unreachable");
  });

  it("reads the pilot as not answering once its newest state is 2 s old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    pairAgent("pill");
    const pilot = parsePilotState(demoPilotWire({ readiness: [] }));
    if (!pilot) throw new Error("demo pilot wire did not parse");
    useNavStreamStore.getState().setPilot("node:pill", pilot, Date.now());
    const { result } = renderHook(() => usePillAlerts("node:pill"), { wrapper });
    expect(result.current.map((a) => a.id)).not.toContain("pilot_not_answering");
    act(() => void vi.advanceTimersByTime(1_500));
    expect(result.current.map((a) => a.id)).not.toContain("pilot_not_answering");
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current.map((a) => a.id)).toContain("pilot_not_answering");
  });
});
