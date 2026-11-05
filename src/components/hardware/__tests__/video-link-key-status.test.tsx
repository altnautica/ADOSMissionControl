/**
 * @license GPL-3.0-only
 *
 * The Video Link panel's "Link key" row: hidden when the ground station does
 * not report `hopping.key_status`, a warning on cold start, neutral when bound.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";
import { VideoLinkPanel } from "../VideoLinkPanel";

const config = vi.hoisted(() => ({ value: null as unknown }));

const client = {
  getVideoConfig: async () => config.value,
  getVideoLatency: async () => null,
  setVideoConfig: async () => null,
};

vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isDemoMode: () => true,
}));
vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: null, apiKey: null, client }),
}));

function body(hopping: Record<string, unknown>) {
  return {
    radio: { channel: 149, band: "u-nii-3", mcs_index: 1, fec_k: 8, fec_n: 12, tx_power_dbm: 20, preset: null },
    encoder: { bitrate_kbps: 4000, width: 1280, height: 720, fps: 30, codec: "h264" },
    adaptive: { available: false },
    hopping: { enabled: true, band: "u-nii-3", hop_period_seconds: null, history: [], ...hopping },
  };
}

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VideoLinkPanel />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  config.value = null;
});

describe("VideoLinkPanel link key row", () => {
  it("is hidden when the agent does not report a key state", async () => {
    config.value = body({});
    renderPanel();
    await screen.findByText("Channel");
    expect(screen.queryByText("Link key")).toBeNull();
  });

  it("warns while the ground station waits for its key", async () => {
    config.value = body({ key_status: "cold_start" });
    renderPanel();
    const value = await screen.findByText("Waiting for key (cold start)");
    expect(screen.getByText("Link key")).toBeTruthy();
    expect(value.className).toContain("text-status-warning");
  });

  it("shows a bound key without a health colour", async () => {
    config.value = body({ key_status: "bound" });
    renderPanel();
    const value = await screen.findByText("Bound");
    expect(value.className).not.toContain("text-status-success");
    expect(value.className).not.toContain("text-status-warning");
  });
});
