/**
 * @module DebugDrawer.test
 * @description Renders the drawer in both modes and confirms child panels
 * and ribbon visibility behave per the mode contract.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../../helpers/intl-wrapper";
import { DebugDrawer } from "@/components/config/can/debug/DebugDrawer";
import { useDroneCanBusStore, useDroneCanFlashStore } from "@/stores/dronecan";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
  }),
}));

beforeEach(() => {
  useDroneCanFlashStore.getState().reset();
});

describe("DebugDrawer", () => {
  it("renders open in flash mode with ribbon visible", () => {
    renderWithIntl(<DebugDrawer mode="flash" />);
    expect(screen.getByTestId("debug-drawer")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-ribbon")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-frame-log")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-rpc-trace")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-node-status-timeline")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-bus-health-gauges")).toBeDefined();
  });

  it("renders collapsed by default in config mode when IDLE", () => {
    renderWithIntl(<DebugDrawer mode="config" />);
    expect(screen.queryByTestId("debug-drawer")).toBeNull();
    expect(screen.getByTestId("debug-drawer-toggle-open")).toBeDefined();
  });

  it("hides ribbon in config mode when idle but opened", () => {
    renderWithIntl(<DebugDrawer mode="config" open={true} />);
    expect(screen.getByTestId("debug-drawer")).toBeDefined();
    expect(screen.queryByTestId("debug-drawer-ribbon")).toBeNull();
    // byte counter only shows when OTA is active
    expect(screen.queryByTestId("debug-drawer-byte-counter")).toBeNull();
  });

  it("shows ribbon in config mode when an OTA is active", () => {
    useDroneCanFlashStore.getState().setSnapshot({
      state: "TRANSFERRING",
      percent: 50,
      bytesSent: 1024,
      bytesTotal: 2048,
      lastOffset: 1024,
      lastChunkLen: 256,
      retries: 0,
      timeouts: 0,
      transitionLog: [],
      rpcTrace: [],
    });
    renderWithIntl(<DebugDrawer mode="config" open={true} />);
    expect(screen.getByTestId("debug-drawer-ribbon")).toBeDefined();
    expect(screen.getByTestId("debug-drawer-byte-counter")).toBeDefined();
  });

  it("toggle button closes the drawer", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <DebugDrawer mode="flash" open={true} onOpenChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("debug-drawer-toggle-close"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows LIVE only while CAN frames are arriving", () => {
    useDroneCanBusStore.getState().clear();
    const { unmount } = renderWithIntl(<DebugDrawer mode="config" open={true} />);
    // A cleared bus has bumped its version counter but carries no traffic.
    expect(screen.queryByTestId("debug-drawer-live")).toBeNull();
    unmount();

    useDroneCanBusStore.setState({ lastFrameAt: Date.now() - 500 });
    const recent = renderWithIntl(<DebugDrawer mode="config" open={true} />);
    expect(screen.getByTestId("debug-drawer-live")).toBeDefined();
    recent.unmount();

    useDroneCanBusStore.setState({ lastFrameAt: Date.now() - 10_000 });
    renderWithIntl(<DebugDrawer mode="config" open={true} />);
    expect(screen.queryByTestId("debug-drawer-live")).toBeNull();
  });
});
