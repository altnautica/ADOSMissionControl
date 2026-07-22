/**
 * Tests for the node Settings "Video" page: the profile gates, the read-only
 * multi-stream camera list vs the single-camera fallback, the writable encode
 * and WFB link fields over the shared config writer, and the read-only rows
 * whose live writes are owned elsewhere (channel, TX power).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import {
  VideoSection,
  parseCameraLegs,
} from "@/components/command/settings/VideoSection";

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE_CONFIG = {
  video: {
    camera: {
      source: "csi",
      codec: "h264",
      width: 1280,
      height: 720,
      fps: 30,
      bitrate_kbps: 4000,
      codec_preference: "auto",
    },
    cameras: [],
    wfb: {
      channel: 149,
      tx_power_dbm: 5,
      wfb_link_preset: "conservative",
      band: "u-nii-3",
      auto_hop_enabled: true,
      adaptive_bitrate_enabled: true,
    },
  },
};

const MULTI_CONFIG = {
  video: {
    ...BASE_CONFIG.video,
    cameras: [
      {
        id: "main",
        role: "primary",
        source: "rtsp://192.168.144.25:8554/main.264",
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 30,
      },
      { id: "ir", source: "rtsp://192.168.144.25:8554/video2", enabled: false },
    ],
  },
};

function renderSection(
  profile: "drone" | "ground-station" | "workstation",
  config: Record<string, unknown> | null = BASE_CONFIG,
) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <VideoSection
      profile={profile}
      config={config}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue, utils };
}

describe("parseCameraLegs", () => {
  it("distinguishes no-list from an empty list and keeps entries defensive", () => {
    expect(parseCameraLegs(null)).toBeNull();
    expect(parseCameraLegs({ video: {} })).toBeNull();
    expect(parseCameraLegs(BASE_CONFIG)).toEqual([]);
    const legs = parseCameraLegs(MULTI_CONFIG)!;
    expect(legs).toHaveLength(2);
    expect(legs[0].id).toBe("main");
    expect(legs[0].enabled).toBe(true);
    expect(legs[1].enabled).toBe(false);
    expect(legs[1].width).toBeNull();
  });
});

describe("VideoSection profile gates", () => {
  it("renders nothing on a workstation", () => {
    const { utils } = renderSection("workstation");
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders only the radio link half on a ground station", () => {
    renderSection("ground-station");
    expect(screen.getByText("Video radio link (WFB)")).toBeTruthy();
    expect(screen.queryByText("Camera streams")).toBeNull();
  });
});

describe("VideoSection camera streams", () => {
  it("renders the single camera block when no multi-stream list is declared", () => {
    renderSection("drone");
    expect(screen.getByText("csi")).toBeTruthy();
    expect(screen.getByText("1280×720 @ 30 fps")).toBeTruthy();
  });

  it("renders the persisted multi-stream legs verbatim", () => {
    renderSection("drone", MULTI_CONFIG);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("ir")).toBeTruthy();
    expect(screen.getByText(/rtsp:\/\/192\.168\.144\.25:8554\/main\.264/)).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
  });
});

describe("VideoSection writable fields", () => {
  it("writes the encode bitrate through the shared config writer", async () => {
    const { setValue } = renderSection("drone");
    const input = screen.getByLabelText("Encode bitrate (kbps)");
    fireEvent.change(input, { target: { value: "6000" } });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("video.camera.bitrate_kbps", "6000"),
    );
  });

  it("writes the auto-hop switch through the shared config writer", async () => {
    const { setValue } = renderSection("ground-station");
    fireEvent.click(screen.getByText("Automatic channel hopping"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "video.wfb.auto_hop_enabled",
        "false",
      ),
    );
  });
});

describe("VideoSection read-only radio rows", () => {
  it("shows channel and TX power without offering a second writer", () => {
    renderSection("ground-station");
    expect(screen.getByText("149")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText(/Link tab's power slider/)).toBeTruthy();
  });
});
