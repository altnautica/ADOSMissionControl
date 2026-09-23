/**
 * @module shared/fc-source-picker-validation.test
 * @description The FC source picker only says "MAVLink validated" for a live
 * status received after the last Apply that reports the applied source, and a
 * failed port enumeration is reported as a failure, not as "no ports".
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FcSourcePicker } from "../FcSourcePicker";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import type { AgentClient } from "@/lib/agent/client";
import type { AgentStatus } from "@/lib/agent/types";

const DEVICE = "dev-1";

function status(over: Partial<AgentStatus> = {}): AgentStatus {
  return {
    version: "1.0.0",
    board: { name: "Board", model: "", tier: 3, ram_mb: 0, cpu_cores: 0, vendor: "", soc: "", arch: "", hw_video_codecs: [] },
    health: { cpu_percent: 1, memory_percent: 1, disk_percent: 1, temperature: null, timestamp: "" },
    fc_connected: true,
    fc_port: "/dev/ttyAMA0",
    fc_baud: 115200,
    transport_open: true,
    mavlink_alive: true,
    heartbeat_age_s: 0.3,
    fc_source: "serial",
    ...over,
  };
}

function attach(client: Partial<AgentClient>) {
  useAgentConnectionStore.setState({
    client: client as unknown as AgentClient,
    nodeDeviceId: DEVICE,
    cloudMode: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useAgentConnectionStore.setState({ client: null, nodeDeviceId: null, cloudMode: false });
  useAgentSystemStore.setState({ status: null, lastUpdatedAt: null });
});

describe("FcSourcePicker validation line", () => {
  it("claims validated for a live status when nothing has been applied", async () => {
    attach({ getMavlinkPorts: vi.fn().mockResolvedValue([]) });
    useAgentSystemStore.setState({ status: status(), lastUpdatedAt: Date.now() });
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {});
    expect(screen.getByText(/MAVLink validated/)).toBeTruthy();
  });

  it("does not claim validated from a stale status", async () => {
    attach({ getMavlinkPorts: vi.fn().mockResolvedValue([]) });
    useAgentSystemStore.setState({ status: status(), lastUpdatedAt: Date.now() - 50_000 });
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {});
    expect(screen.queryByText(/MAVLink validated/)).toBeNull();
    expect(screen.getByText(/waiting for a live status/)).toBeTruthy();
  });

  it("waits for a post-apply status that reports the applied source", async () => {
    const setMavlinkSource = vi.fn().mockResolvedValue(undefined);
    attach({ getMavlinkPorts: vi.fn().mockResolvedValue([]), setMavlinkSource });
    // Pre-apply status: live, alive, on a serial source.
    useAgentSystemStore.setState({ status: status(), lastUpdatedAt: Date.now() - 500 });
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {});
    expect(screen.getByText(/MAVLink validated/)).toBeTruthy();

    // The form is seeded from the status (serial, /dev/ttyAMA0); apply it.
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });
    expect(setMavlinkSource).toHaveBeenCalled();
    expect(screen.queryByText(/MAVLink validated/)).toBeNull();
    expect(screen.getByText(/waiting for the agent to report the new source/)).toBeTruthy();

    // A newer live poll reporting the applied source/port confirms it.
    await act(async () => {
      vi.advanceTimersByTime(10);
      useAgentSystemStore.setState({ status: status(), lastUpdatedAt: Date.now() + 5 });
    });
    expect(screen.getByText(/MAVLink validated/)).toBeTruthy();
  });

  it("reports a failed port enumeration instead of 'no ports'", async () => {
    attach({
      getMavlinkPorts: vi.fn().mockRejectedValue(new Error("Agent API 504")),
    });
    useAgentSystemStore.setState({ status: status(), lastUpdatedAt: Date.now() });
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {});
    expect(screen.getByText(/Could not list serial ports: Agent API 504/)).toBeTruthy();
    expect(screen.queryByText("No serial ports detected")).toBeNull();
  });
});
