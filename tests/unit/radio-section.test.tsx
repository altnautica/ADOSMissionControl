/**
 * Tests for the node Settings "Radio" page: the fleet-addressing block that
 * came with the fleet split, the link fields that moved off the Video page,
 * and the modulation band whose whole job is to never show a writable rung the
 * adaptive ladder is silently overriding.
 *
 * `fleet_slot` being writable is the failure this file guards hardest: two
 * nodes on one slot share a wfb-ng channel_id and re-initialise each other's
 * FEC decoder about once a second, which presents as unexplained link loss.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { RadioSection } from "@/components/command/settings/RadioSection";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const BASE_CONFIG = {
  video: {
    wfb: {
      fleet_id: 1,
      fleet_slot: 3,
      channel: 149,
      tx_power_dbm: 5,
      mcs_index: 1,
      adaptive_mcs_max: 3,
      wfb_link_preset: "conservative",
      band: "u-nii-3",
      auto_hop_enabled: true,
      adaptive_bitrate_enabled: false,
    },
  },
};

function withWfb(patch: Record<string, unknown>) {
  return { video: { wfb: { ...BASE_CONFIG.video.wfb, ...patch } } };
}

const NODE = "node-1";

/** Seed the live radio readback the modulation rows render, filed under this
 * page's node the way a status report files it. */
function setRadio(
  radio: {
    mcsIndex: number | null;
    snrDb: number | null;
    mcsLadderCap?: number | null;
  } | null,
) {
  const { focusedDeviceId: _f, byDevice: _b, ...slice } =
    useAgentCapabilitiesStore.getState();
  useAgentCapabilitiesStore.setState({
    byDevice: { [NODE]: { ...slice, radio: radio as never } },
  });
}

beforeEach(() => setRadio(null));
afterEach(() => {
  setRadio(null);
  vi.restoreAllMocks();
});

function renderSection(
  profile: "drone" | "ground-station" | "workstation",
  config: Record<string, unknown> | null = BASE_CONFIG,
) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <RadioSection
      nodeDeviceId={NODE}
      profile={profile}
      config={config}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue, utils };
}

describe("RadioSection profile gate", () => {
  it("renders nothing on a workstation, which carries no radio", () => {
    const { utils } = renderSection("workstation");
    expect(utils.container.innerHTML).toBe("");
  });

  it("says so plainly when the agent advertises no WFB block", () => {
    renderSection("drone", { video: {} });
    expect(screen.getByText(/does not expose a WFB radio block/)).toBeTruthy();
    expect(screen.queryByText("Fleet ID")).toBeNull();
  });

  it("does not claim the block is missing while the config has not loaded", () => {
    renderSection("drone", null);
    expect(screen.queryByText(/does not expose a WFB radio block/)).toBeNull();
    expect(screen.queryByText("Fleet ID")).toBeNull();
  });
});

describe("RadioSection fleet addressing", () => {
  it("holds a fleet id write behind a confirm, then writes it", async () => {
    const { setValue } = renderSection("drone");
    fireEvent.change(screen.getByLabelText("Fleet ID"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getAllByText("Apply")[0]);
    expect(setValue).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Change fleet ID" }));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("video.wfb.fleet_id", "7"),
    );
  });

  it("reports the assigned slot and never offers it as an input", () => {
    renderSection("drone");
    expect(screen.getByText("Slot 3")).toBeTruthy();
    expect(screen.queryByLabelText("Fleet slot")).toBeNull();
  });

  it("names slot 0 as the ground station rather than showing a bare 0", () => {
    renderSection("ground-station", withWfb({ fleet_slot: 0 }));
    expect(screen.getByText("Ground station (slot 0)")).toBeTruthy();
  });

  it("warns that slot 0 on a drone means no slot was assigned", () => {
    renderSection("drone", withWfb({ fleet_slot: 0 }));
    expect(screen.getByText("Not assigned")).toBeTruthy();
    expect(screen.queryByText("Ground station (slot 0)")).toBeNull();
  });
});

describe("RadioSection link fields", () => {
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

  it("shows channel and TX power read-only, since other writers own them", () => {
    renderSection("ground-station");
    expect(screen.getByText("149")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText(/Link tab's power slider/)).toBeTruthy();
  });

  it("offers no channel-width control — the transmitter is pinned to 20 MHz", () => {
    renderSection("drone");
    expect(screen.queryByText(/bandwidth/i)).toBeNull();
    expect(screen.queryByText(/channel width/i)).toBeNull();
  });
});

describe("RadioSection modulation", () => {
  it("offers a manual rung only while the adaptive ladder is off", () => {
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: false }));
    expect(screen.getByLabelText("MCS index")).toBeTruthy();
  });

  it("offers the adaptive ceiling only while the ladder owns the rung", () => {
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: false }));
    expect(screen.queryByLabelText("Adaptive ceiling (MCS)")).toBeNull();
  });

  it("writes the adaptive ceiling through the shared config writer", async () => {
    const { setValue } = renderSection(
      "drone",
      withWfb({ adaptive_bitrate_enabled: true }),
    );
    const input = screen.getByLabelText("Adaptive ceiling (MCS)");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(
      within(input.parentElement as HTMLElement).getByText("Apply"),
    );
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("video.wfb.adaptive_mcs_max", "5"),
    );
  });

  it("replaces the manual rung with the live readout when adaptive is on", () => {
    setRadio({ mcsIndex: 3, snrDb: 27.4 });
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: true }));
    // No writable field the controller would silently override…
    expect(screen.queryByLabelText("MCS index")).toBeNull();
    // …and the rung actually running is stated, rounded to whole dB.
    expect(screen.getByText("auto (MCS 3 at 27 dB)")).toBeTruthy();
  });

  it("renders the applied rung beside the manual field, not the stored value", () => {
    setRadio({ mcsIndex: 5, snrDb: 33 });
    renderSection("drone", withWfb({ mcs_index: 1 }));
    expect(screen.getByText("MCS 5 at 33 dB")).toBeTruthy();
  });

  it("names the ladder cap so a policy-limited rung is not read as a weak link", () => {
    setRadio({ mcsIndex: 3, snrDb: 35, mcsLadderCap: 3 });
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: true }));
    expect(screen.getByText("auto (MCS 3 at 35 dB, capped 3)")).toBeTruthy();
  });

  it("drops the cap clause when the cap constrains nothing", () => {
    setRadio({ mcsIndex: 3, snrDb: 35, mcsLadderCap: 5 });
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: true }));
    expect(screen.getByText("auto (MCS 3 at 35 dB)")).toBeTruthy();
  });

  it("renders a measured MCS 0 as a real rung, never as unknown", () => {
    // 0 is the slowest rung, not a missing reading.
    setRadio({ mcsIndex: 0, snrDb: 4, mcsLadderCap: null });
    renderSection("drone");
    expect(screen.getByText("MCS 0 at 4 dB")).toBeTruthy();
    expect(screen.queryByText("no reading")).toBeNull();
  });

  it("says 'no reading' rather than inventing a rung when the link is silent", () => {
    setRadio({ mcsIndex: null, snrDb: null });
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: true }));
    expect(screen.getByText("no reading")).toBeTruthy();
  });

  it("drops the dB clause when the rung is known but the SNR is not", () => {
    setRadio({ mcsIndex: 2, snrDb: null });
    renderSection("drone");
    expect(screen.getByText("MCS 2")).toBeTruthy();
  });

  it("shows the preset's rung instead of a manual field the preset would overwrite", () => {
    renderSection(
      "drone",
      withWfb({ wfb_link_preset: "balanced", adaptive_bitrate_enabled: false }),
    );
    expect(screen.queryByLabelText("MCS index")).toBeNull();
    expect(screen.getByText("MCS 3 (set by the Balanced preset)")).toBeTruthy();
  });

  it("draws neither rung control while adaptive bitrate is unknown", () => {
    const wfb: Record<string, unknown> = { ...BASE_CONFIG.video.wfb };
    delete wfb.adaptive_bitrate_enabled;
    renderSection("drone", { video: { wfb } });
    expect(screen.queryByLabelText("MCS index")).toBeNull();
    expect(screen.queryByLabelText("Adaptive ceiling (MCS)")).toBeNull();
    // The switch itself reads unknown, not OFF.
    expect(screen.getByText("not reported")).toBeTruthy();
  });

  it("reads the live rung from this node, not the focused one", () => {
    // The flat slice belongs to the focused node; this page's node has no
    // reading yet.
    useAgentCapabilitiesStore.setState({
      radio: { mcsIndex: 4, snrDb: 30 } as never,
    });
    renderSection("drone", withWfb({ adaptive_bitrate_enabled: true }));
    expect(screen.queryByText("auto (MCS 4 at 30 dB)")).toBeNull();
    expect(screen.getByText("no reading")).toBeTruthy();
  });
});
