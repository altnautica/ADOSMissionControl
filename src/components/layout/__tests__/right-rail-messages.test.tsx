/**
 * @module layout/right-rail-messages.test
 * @description The right rail's drone panel streams the FC's status
 * messages. It is titled "Messages", so "Flight logs" keeps meaning the
 * recorded flights on the Logs page.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/components/drone-detail/DroneLogsPanel", () => ({
  DroneLogsPanel: () => <div data-testid="drone-logs" />,
}));
vi.mock("@/components/mcp/watch/McpActivityPanel", () => ({
  McpActivityPanel: () => null,
}));

import messages from "../../../../locales/en.json";
import { RightRail } from "../RightRail";
import { useUiStore } from "@/stores/ui-store";
import { useDroneManager } from "@/stores/drone-manager";

afterEach(() => {
  cleanup();
  useUiStore.setState({ rightRailPanel: null });
  useDroneManager.setState({ selectedDroneId: null });
});

describe("RightRail drone panel", () => {
  it("is titled Messages", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    useUiStore.setState({ rightRailPanel: "logs" });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RightRail />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("drone-logs")).toBeTruthy();
    expect(screen.getByText(messages.dashboard.messages)).toBeTruthy();
    expect(screen.queryByText(messages.dashboard.flightLogs)).toBeNull();
  });
});
