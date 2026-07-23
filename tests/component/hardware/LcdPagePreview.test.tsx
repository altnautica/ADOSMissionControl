/**
 * @module LcdPagePreview.test
 * @description Smoke tests for the live LCD thumbnail card. Verifies
 * placeholder rendering, polling behavior, cleanup on unmount, and
 * that the empty state renders when no snapshot URL is advertised.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, act } from "@testing-library/react";
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
    Monitor: makeStub("Monitor"),
    Loader2: makeStub("Loader2"),
    ImageOff: makeStub("ImageOff"),
  };
});

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://gs-node.local:8080", apiKey: null, client: null }),
}));

import { LcdPagePreview } from "@/components/hardware/LcdPagePreview";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initial = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  // Pin Date.now so the cache-bust string is deterministic, then
  // advance the clock manually between asserts.
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  // Force IntersectionObserver to not exist so the component renders
  // immediately in the JSDOM environment.
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: undefined,
  });
  useAgentCapabilitiesStore.setState({ ...initial, loaded: true }, true);
});

afterEach(() => {
  vi.useRealTimers();
  useAgentCapabilitiesStore.setState(initial, true);
});

describe("LcdPagePreview", () => {
  it("renders nothing when no display is bound", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "none" },
    });
    const { container } = renderWithIntl(<LcdPagePreview />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the placeholder when no snapshot URL is set", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "spi-lcd", hasTouch: true },
    });
    renderWithIntl(<LcdPagePreview />);
    expect(screen.getByText("No snapshot")).toBeDefined();
  });

  it("renders an img tag with the cache-busted snapshot URL", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        snapshotUrl: "http://gs-node.local:8080/api/v1/display/snapshot.png",
        activePage: "dashboard",
      },
    });
    const { container } = renderWithIntl(<LcdPagePreview />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toMatch(
      /\/api\/v1\/display\/snapshot\.png\?t=\d+/,
    );
  });

  it("updates the src on each poll tick", async () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        snapshotUrl: "http://gs-node.local:8080/api/v1/display/snapshot.png",
      },
    });
    const { container } = renderWithIntl(<LcdPagePreview />);
    const firstSrc = container.querySelector("img")!.getAttribute("src");
    // Advance one full poll interval; the cache-bust query string changes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const secondSrc = container.querySelector("img")!.getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc);
  });

  it("renders the device caption with hostname and active page", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        snapshotUrl: "http://gs-node.local:8080/snap.png",
        activePage: "dashboard",
      },
    });
    renderWithIntl(<LcdPagePreview />);
    expect(screen.getByText("gs-node - dashboard")).toBeDefined();
  });

  it("clears the polling timer on unmount", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        snapshotUrl: "http://gs-node.local:8080/snap.png",
      },
    });
    const { unmount } = renderWithIntl(<LcdPagePreview />);
    const beforeCount = vi.getTimerCount();
    expect(beforeCount).toBeGreaterThan(0);
    unmount();
    // After unmount, the interval registered by the component is gone.
    expect(vi.getTimerCount()).toBeLessThan(beforeCount);
  });
});
