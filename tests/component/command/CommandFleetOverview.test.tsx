/**
 * Component tests for the Command multi-agent overview.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const videoEnabledCalls: boolean[] = [];

vi.mock("lucide-react", () => {
  const Icon = ({ name, ...props }: Record<string, unknown> & { name: string }) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    Activity: (props: Record<string, unknown>) => <Icon name="Activity" {...props} />,
    Battery: (props: Record<string, unknown>) => <Icon name="Battery" {...props} />,
    Cpu: (props: Record<string, unknown>) => <Icon name="Cpu" {...props} />,
    Expand: (props: Record<string, unknown>) => <Icon name="Expand" {...props} />,
    Gauge: (props: Record<string, unknown>) => <Icon name="Gauge" {...props} />,
    Loader2: (props: Record<string, unknown>) => <Icon name="Loader2" {...props} />,
    MapPin: (props: Record<string, unknown>) => <Icon name="MapPin" {...props} />,
    Pause: (props: Record<string, unknown>) => <Icon name="Pause" {...props} />,
    Pin: (props: Record<string, unknown>) => <Icon name="Pin" {...props} />,
    PinOff: (props: Record<string, unknown>) => <Icon name="PinOff" {...props} />,
    Play: (props: Record<string, unknown>) => <Icon name="Play" {...props} />,
    Radio: (props: Record<string, unknown>) => <Icon name="Radio" {...props} />,
    RefreshCw: (props: Record<string, unknown>) => <Icon name="RefreshCw" {...props} />,
    Satellite: (props: Record<string, unknown>) => <Icon name="Satellite" {...props} />,
    Thermometer: (props: Record<string, unknown>) => <Icon name="Thermometer" {...props} />,
    Video: (props: Record<string, unknown>) => <Icon name="Video" {...props} />,
    VideoOff: (props: Record<string, unknown>) => <Icon name="VideoOff" {...props} />,
    WifiOff: (props: Record<string, unknown>) => <Icon name="WifiOff" {...props} />,
  };
});

vi.mock("@/hooks/use-agent-video-session", () => ({
  useAgentVideoSession: ({ enabled }: { enabled: boolean }) => {
    videoEnabledCalls.push(enabled);
    return {
      state: enabled ? "connected" : "idle",
      error: null,
      stats: { fps: enabled ? 30 : 0, bitrateKbps: enabled ? 4200 : 0 },
    };
  },
}));

import { CommandFleetOverview } from "@/components/command/CommandFleetOverview";

function drone(i: number): FleetNodeEntry {
  return {
    _id: `drone-${i}`,
    userId: "user",
    deviceId: `device-${i}`,
    name: `Agent ${i}`,
    apiKey: "secret",
    board: "Reference",
    tier: 2,
    lastIp: `192.168.1.${10 + i}`,
    lastSeen: Date.now(),
    fcConnected: true,
    pairedAt: Date.now() - i,
    profile: "drone",
    isLocal: false,
  };
}

describe("CommandFleetOverview", () => {
  beforeEach(() => {
    videoEnabledCalls.length = 0;
    useCommandFleetStore.getState().clear();
  });

  it("renders paired agents with quick telemetry and opens focused details", () => {
    const paired = [drone(1), drone(2)];
    useCommandFleetStore.getState().setCloudStatuses([
      {
        deviceId: "device-1",
        version: "0.9.10",
        boardName: "Reference",
        cpuPercent: 21,
        memoryPercent: 42,
        fcConnected: true,
        services: [{ name: "ados-api", status: "running" }],
        videoState: "stopped",
        videoWhepPort: 0,
        updatedAt: Date.now(),
      },
      {
        deviceId: "device-2",
        version: "0.9.10",
        boardName: "Reference",
        cpuPercent: 33,
        memoryPercent: 55,
        fcConnected: false,
        services: [],
        videoState: "stopped",
        videoWhepPort: 0,
        updatedAt: Date.now() - 30_000,
      },
    ]);
    useCommandFleetStore.getState().setTelemetry("device-1", {
      mode: "LOITER",
      armed: false,
      battery: { remaining: 84, voltage: 15.8 },
      gps: { satellites: 14, fix_type: 3 },
      position: { alt_rel: 42 },
    });

    const onOpenAgent = vi.fn();
    const { getByText } = renderWithIntl(
      <CommandFleetOverview
        fleetNodes={paired}
        onOpenAgent={onOpenAgent}
        onOpenPairing={() => {}}
      />,
    );

    expect(getByText("Agent Overview")).toBeTruthy();
    expect(getByText("Agent 1")).toBeTruthy();
    expect(getByText("Agent 2")).toBeTruthy();
    expect(getByText("LOITER")).toBeTruthy();

    fireEvent.click(getByText("Agent 1"));
    expect(onOpenAgent).toHaveBeenCalledWith("device-1");
  });

  it("caps active overview video sessions at four", () => {
    const paired = Array.from({ length: 5 }, (_, i) => drone(i + 1));
    useCommandFleetStore.getState().setCloudStatuses(
      paired.map((d) => ({
        deviceId: d.deviceId,
        version: "0.9.10",
        boardName: "Reference",
        cpuPercent: 20,
        memoryPercent: 40,
        fcConnected: true,
        services: [{ name: "ados-video", status: "running" }],
        lastIp: d.lastIp,
        videoState: "running",
        videoWhepUrl: "/whep",
        updatedAt: Date.now(),
      })),
    );

    renderWithIntl(
      <CommandFleetOverview
        fleetNodes={paired}
        onOpenAgent={() => {}}
        onOpenPairing={() => {}}
      />,
    );

    expect(videoEnabledCalls.slice(-paired.length).filter(Boolean)).toHaveLength(4);
  });
});
