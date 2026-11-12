/**
 * @license GPL-3.0-only
 *
 * STATUSTEXT is collected by a shell-level bridge for every drone, whether
 * or not the Logs rail is open, and follows a reconnect onto the new
 * protocol. The rail renders from that log, keeps the operator's Paused
 * choice across a hover, and labels severities through the locale.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStatusLogStore } from "@/stores/drone-status-log-store";
import { useLogActivityStore } from "@/stores/log-activity-store";

import messages from "../../../../locales/en.json";
import { DroneLogsPanel } from "../DroneLogsPanel";
import { StatusTextLogBridge } from "@/components/layout/StatusTextLogBridge";

type Listener = (d: { severity: number; text: string }) => void;
function fakeProtocol() {
  const listeners: Listener[] = [];
  return {
    listeners,
    onStatusText: vi.fn((l: Listener) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    }),
  };
}

function setDrone(protocol: ReturnType<typeof fakeProtocol>) {
  useDroneManager.setState({ drones: new Map([["d1", { protocol } as never]]) });
}

beforeEach(() => {
  useDroneStatusLogStore.setState({ messages: {} });
  useLogActivityStore.setState({ counts: {} });
});

describe("StatusTextLogBridge", () => {
  it("collects messages with no Logs rail mounted, and follows a reconnect", () => {
    const first = fakeProtocol();
    setDrone(first);
    render(<StatusTextLogBridge />);
    act(() => first.listeners[0]({ severity: 4, text: "Low battery" }));
    expect(useDroneStatusLogStore.getState().messages.d1).toHaveLength(1);
    expect(useLogActivityStore.getState().counts.d1).toBe(1);

    const second = fakeProtocol();
    act(() => setDrone(second));
    expect(first.listeners).toHaveLength(0);
    expect(second.onStatusText).toHaveBeenCalledTimes(1);
  });
});

describe("DroneLogsPanel", () => {
  function panel() {
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DroneLogsPanel droneId="d1" />
      </NextIntlClientProvider>,
    );
  }

  it("shows messages that arrived before it opened, with a translated severity", () => {
    useDroneStatusLogStore.getState().append("d1", 4, "Low battery");
    panel();
    expect(screen.getByText("Low battery")).toBeTruthy();
    expect(screen.getAllByText(messages.logs.severityLevel.warning).length).toBeGreaterThan(0);
  });

  it("keeps Paused after the pointer leaves the list", () => {
    useDroneStatusLogStore.getState().append("d1", 6, "hello");
    const { container } = panel();
    fireEvent.click(screen.getByTitle(messages.logs.autoScrollOn));
    const list = container.querySelector(".overflow-y-auto")!;
    fireEvent.mouseEnter(list);
    fireEvent.mouseLeave(list);
    expect(screen.getByTitle(messages.logs.autoScrollOff)).toBeTruthy();
  });
});
