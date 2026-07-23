/**
 * @module LcdRemoteControl.test
 * @description Verifies the four-button remote control: rendering,
 * active-page highlight, click invocation of the agent client, and
 * the offline-disable + tooltip.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("lucide-react", () => {
  function makeStub(name: string) {
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    }
    StubIcon.displayName = `StubIcon(${name})`;
    return StubIcon;
  }
  return {
    __esModule: true,
    LayoutDashboard: makeStub("LayoutDashboard"),
    Video: makeStub("Video"),
    Settings: makeStub("Settings"),
    MoreHorizontal: makeStub("MoreHorizontal"),
  };
});

const mockClient = {
  setDisplayPage: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://gs-node.local:8080", apiKey: null, client: mockClient }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { LcdRemoteControl } from "@/components/hardware/LcdRemoteControl";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";

const initialCaps = useAgentCapabilitiesStore.getState();
const initialSys = useAgentSystemStore.getState();

beforeEach(() => {
  toastFn.mockClear();
  mockClient.setDisplayPage.mockClear();
  useAgentCapabilitiesStore.setState(
    {
      ...initialCaps,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        activePage: "dashboard",
      },
    },
    true,
  );
  useAgentSystemStore.setState({ ...initialSys, lastUpdatedAt: Date.now() });
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCaps, true);
  useAgentSystemStore.setState(initialSys, true);
});

describe("LcdRemoteControl", () => {
  it("renders all four page buttons", () => {
    renderWithIntl(<LcdRemoteControl />);
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("Video")).toBeDefined();
    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByText("More")).toBeDefined();
  });

  it("highlights the currently active page", () => {
    const { container } = renderWithIntl(<LcdRemoteControl />);
    const dash = container.querySelector('[data-page="dashboard"]');
    expect(dash?.getAttribute("data-active")).toBe("true");
    const video = container.querySelector('[data-page="video"]');
    expect(video?.getAttribute("data-active")).toBe("false");
  });

  it("fires setDisplayPage and updates the optimistic active marker on click", async () => {
    const { container } = renderWithIntl(<LcdRemoteControl />);
    fireEvent.click(screen.getByText("Video"));
    await waitFor(() => {
      expect(mockClient.setDisplayPage).toHaveBeenCalledWith("video");
    });
    const video = container.querySelector('[data-page="video"]');
    expect(video?.getAttribute("data-active")).toBe("true");
  });

  it("disables every button when the agent heartbeat is stale", () => {
    useAgentSystemStore.setState({
      ...initialSys,
      lastUpdatedAt: Date.now() - 120_000,
    });
    const { container } = renderWithIntl(<LcdRemoteControl />);
    const buttons = container.querySelectorAll("button[data-page]");
    expect(buttons.length).toBe(4);
    for (const btn of buttons) {
      expect(btn.hasAttribute("disabled")).toBe(true);
    }
    expect(screen.getByText("Agent offline")).toBeDefined();
  });

  it("rolls back the optimistic page when the agent rejects the request", async () => {
    mockClient.setDisplayPage.mockRejectedValueOnce(new Error("kaboom"));
    const { container } = renderWithIntl(<LcdRemoteControl />);
    fireEvent.click(screen.getByText("More"));
    await waitFor(() => {
      expect(toastFn).toHaveBeenCalledWith("kaboom", "error");
    });
    const more = container.querySelector('[data-page="more"]');
    // After rollback the active marker is back on "dashboard".
    expect(more?.getAttribute("data-active")).toBe("false");
    const dash = container.querySelector('[data-page="dashboard"]');
    expect(dash?.getAttribute("data-active")).toBe("true");
  });
});
