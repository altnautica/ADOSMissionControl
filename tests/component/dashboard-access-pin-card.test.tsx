/**
 * The dashboard PIN card never turns an unreadable status into "No PIN": a
 * failed read shows "Unknown" with a retry, and the card reads the node it is
 * rendered for.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

const getStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent/local-pair-client", () => ({
  getDashboardPinStatus: getStatus,
  setDashboardPin: vi.fn(),
  clearDashboardPin: vi.fn(),
}));

import { DashboardAccessPinCard } from "@/components/command/system/DashboardAccessPinCard";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";

const NODE_A = {
  deviceId: "node-a",
  name: "Node A",
  hostname: "http://192.168.1.50:8080",
  apiKey: "key-a",
  profile: "drone",
} as LocalNode;

beforeEach(() => {
  getStatus.mockReset();
  useLocalNodesStore.setState({ nodes: [NODE_A] });
});

afterEach(() => {
  cleanup();
  useLocalNodesStore.setState({ nodes: [] });
});

describe("DashboardAccessPinCard", () => {
  it("shows Unknown with a retry when the status read fails", async () => {
    getStatus.mockRejectedValueOnce(new Error("proxy timeout"));
    render(<DashboardAccessPinCard nodeDeviceId="node-a" />);

    expect(await screen.findByText("Unknown")).toBeDefined();
    expect(screen.queryByText("No PIN")).toBeNull();

    getStatus.mockResolvedValueOnce({ pinSet: true, locked: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("PIN set")).toBeDefined();
  });

  it("reads the node it is rendered for", async () => {
    getStatus.mockResolvedValue({ pinSet: false, locked: false });
    render(<DashboardAccessPinCard nodeDeviceId="node-a" />);

    expect(await screen.findByText("No PIN")).toBeDefined();
    expect(getStatus).toHaveBeenCalledWith("http://192.168.1.50:8080", "key-a");
  });
});
