/**
 * @module nodes/hover-card-companion.test
 * @description The hover card's onboard-computer section shows only what the
 * node reported: no "0/0 services" count when no service list arrived, and a
 * capability chip only for a capability the node described (or a feature the
 * operator enabled on it).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup } from "@testing-library/react";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

import messages from "../../../../../locales/en.json";
import { NodeStatusHoverCard } from "../NodeStatusHoverCard";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useNodeFeaturesStore } from "@/stores/node-features-store";

const companionDrone: FleetNodeEntry = {
  _id: "node:drone-a",
  userId: "u",
  deviceId: "drone-a",
  name: "Drone A",
  apiKey: "",
  pairedAt: Date.now(),
  lastSeen: Date.now(),
  profile: "drone",
  isLocal: false,
  board: "rpi-cm4",
};

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NodeStatusHoverCard node={companionDrone} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useAgentCapabilitiesStore.setState({ byDevice: {} });
  useNodeFeaturesStore.setState({ enabled: {} });
});

describe("NodeStatusHoverCard — onboard computer", () => {
  it("shows no service count and no capability chips for a node that reported neither", () => {
    renderCard();
    expect(screen.queryByText(/services running/)).toBeNull();
    for (const chip of ["Video", "Vision", "World Model", "Compute"]) {
      expect(screen.queryByText(chip)).toBeNull();
    }
  });

  it("shows only the capabilities the node described and the features enabled on it", () => {
    useAgentCapabilitiesStore.setState({
      byDevice: {
        "drone-a": {
          cameras: [],
          visionAvailable: true,
          compute: { npu_available: false, gpu_available: false },
        },
      } as never,
    });
    useNodeFeaturesStore.setState({ enabled: { "drone-a": ["world-model"] } });
    renderCard();
    expect(screen.getByText("Vision")).toBeTruthy();
    expect(screen.getByText("World Model")).toBeTruthy();
    expect(screen.queryByText("Video")).toBeNull();
    expect(screen.queryByText("Compute")).toBeNull();
  });
});
