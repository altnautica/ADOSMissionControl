/**
 * @license GPL-3.0-only
 *
 * The flight screen's video placeholder speaks the shared spec's video
 * states (`video.state.*`): connecting, no source, failed, reconnecting.
 * It never shows a transport's exception text, and a failed or
 * reconnecting feed offers a retry. The frozen-picture banner reads the
 * spec's frozen word.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const video = vi.hoisted(() => ({
  state: "idle" as "idle" | "connecting" | "connected" | "failed",
  error: null as string | null,
  retryDelaySec: 0,
  retry: vi.fn(),
}));

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    createStore: vi.fn(() => ({})),
  };
});

vi.mock("@/hooks/use-singleton-agent-video", () => ({
  useSingletonAgentVideo: () => ({
    state: video.state,
    activeTransport: null,
    error: video.error,
    retry: video.retry,
    retryDelaySec: video.retryDelaySec,
  }),
}));

import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { VideoCanvas, cockpitVideoState } from "../VideoCanvas";
import { CockpitVideoStatusBanner } from "@/components/cockpit/CockpitVideoStatusBanner";
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";

const DRONE = "video-words";
const RAW = "WHEP offer refused: 503 upstream";

function renderCanvas() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VideoCanvas chrome="cockpit" droneId={DRONE} />
    </NextIntlClientProvider>,
  );
}

function stateText(): string {
  return document.querySelector("[data-video-state]")?.textContent ?? "";
}

beforeEach(() => {
  video.state = "idle";
  video.error = null;
  video.retryDelaySec = 0;
  video.retry.mockClear();
  useVideoStore.setState({ isStreaming: false, agentWhepUrl: "http://agent.local:8889/main/whep" });
});

afterEach(() => {
  cleanup();
  useVideoStore.setState({ isStreaming: false, agentWhepUrl: null, degradedReason: null, degradedSince: null });
});

describe("flight-screen video placeholder", () => {
  it("reads connecting while a dial runs", () => {
    video.state = "connecting";
    renderCanvas();
    expect(stateText()).toBe(specString("video.state.connecting"));
    expect(screen.queryByTestId("video-retry")).toBeNull();
  });

  it("reads failed with a retry, never the exception's text", () => {
    video.state = "failed";
    video.error = RAW;
    renderCanvas();
    expect(stateText()).toBe(specString("video.state.failed"));
    expect(document.body.textContent).not.toContain(RAW);
    const retry = screen.getByTestId("video-retry");
    expect(retry.textContent).toBe(specString("video.state.retry"));
    fireEvent.click(retry);
    expect(video.retry).toHaveBeenCalledTimes(1);
  });

  it("reads reconnecting while an automatic retry is pending, with its countdown and a retry", () => {
    video.state = "failed";
    video.error = RAW;
    video.retryDelaySec = 3;
    renderCanvas();
    expect(stateText()).toBe(specString("video.state.reconnecting"));
    expect(screen.getByTestId("video-retrying-in").textContent).toBe(specString("video.state.retrying_in", { s: 3 }));
    expect(screen.getByTestId("video-retry")).toBeTruthy();
    expect(document.body.textContent).not.toContain(RAW);
  });

  it("reads no source when the node offers no feed", () => {
    useVideoStore.setState({ agentWhepUrl: null });
    renderCanvas();
    expect(stateText()).toBe(specString("video.state.no_source"));
    expect(screen.queryByTestId("video-retry")).toBeNull();
  });

  it("maps each condition to one spec state", () => {
    const base = { connecting: false, failed: false, retrying: false, recovering: false, running: false, hasSource: true };
    expect(cockpitVideoState({ ...base, connecting: true })).toBe("connecting");
    expect(cockpitVideoState({ ...base, recovering: true })).toBe("reconnecting");
    expect(cockpitVideoState({ ...base, failed: true })).toBe("failed");
    expect(cockpitVideoState({ ...base, failed: true, retrying: true })).toBe("reconnecting");
    expect(cockpitVideoState({ ...base, running: true })).toBe("connecting");
    expect(cockpitVideoState({ ...base, hasSource: false })).toBe("no_source");
    expect(cockpitVideoState(base)).toBe("no_source");
  });
});

describe("frozen picture banner", () => {
  it("reads the spec's frozen word", () => {
    useDroneManager.setState({ selectedDroneId: DRONE } as never);
    useVideoStore.setState({ isStreaming: true, degradedReason: "ice-disconnect", degradedSince: Date.now() } as never);
    render(<CockpitVideoStatusBanner droneId={DRONE} />);
    const banner = screen.getByTestId("cockpit-video-frozen");
    expect(banner.textContent).toContain(specString("video.state.frozen"));
    expect(banner.getAttribute("data-video-degraded")).toBe("ice-disconnect");
  });
});
