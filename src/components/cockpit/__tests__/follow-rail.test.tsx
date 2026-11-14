import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type * as WriterModule from "@/lib/skills/plugin-config-writer";

const mocks = vi.hoisted(() => ({
  activateBound: vi.fn(async () => {}),
  write: vi.fn(async () => true),
  toast: vi.fn(),
}));

// vi.mock factories are hoisted above the static imports, so the store
// factory loads zustand itself.
vi.mock("@/lib/skills", async () => {
  const { create } = await import("zustand");
  return {
    activateBound: mocks.activateBound,
    buildSkillContext: (droneId: string) => ({ droneId }),
    useSkillRegistry: create(() => ({
      skills: new Map<string, unknown>(),
      states: new Map<string, Map<string, { kind: string }>>(),
    })),
  };
});
vi.mock("@/lib/skills/plugin-config-writer", async (orig) => ({
  ...(await orig<typeof WriterModule>()),
  writePluginConfigValue: mocks.write,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import messages from "../../../../locales/en.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { useSkillRegistry } from "@/lib/skills";
import { FollowRail } from "@/components/cockpit/FollowRail";
import { FOLLOW_SKILL_ID } from "@/hooks/use-following-mode";
import { FOLLOW_SETTING_ECHO_TIMEOUT_MS, useFollowSettingPendingStore } from "@/hooks/use-follow-setting";
import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { followState } from "./follow-fixtures";

const DRONE = "node:rail-test";

function setSkills(ids: string[], states: Record<string, string> = {}) {
  useSkillRegistry.setState({
    skills: new Map(ids.map((id) => [id, { id }])),
    states: new Map([[DRONE, new Map(Object.entries(states).map(([id, kind]) => [id, { kind }]))]]),
  } as never);
}

function renderRail(withRec = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FollowRail droneId={DRONE} withRec={withRec} />
    </NextIntlClientProvider>,
  );
}

describe("FollowRail", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useSelectedTargetStore.setState({ designated: null });
    useFollowSettingPendingStore.setState({ byKey: {} });
    useVideoStreamsStore.getState().clear();
    setSkills([FOLLOW_SKILL_ID, "pause", "rth", "land"]);
    mocks.activateBound.mockClear();
    mocks.write.mockClear();
    mocks.toast.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is hidden outside following mode", () => {
    renderRail();
    expect(screen.queryByTestId("follow-rail")).toBeNull();
  });

  it("offers FOLLOW for a designated target and fires the follow skill through the gate", () => {
    useSelectedTargetStore.setState({ designated: { droneId: DRONE } as never });
    renderRail();
    const btn = screen.getByTestId("frail-follow");
    expect(btn.textContent).toContain("Follow ▸");
    fireEvent.click(btn);
    expect(mocks.activateBound).toHaveBeenCalledWith(FOLLOW_SKILL_ID, { droneId: DRONE });
  });

  it("reads TRACKING while following and never repeats hold, return or land", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    setSkills([FOLLOW_SKILL_ID, "pause", "rth", "land"]);
    renderRail();
    expect(screen.getByTestId("frail-follow").textContent).toContain(specString("follow.tracking_close"));
    for (const id of ["pause", "rth", "land"]) {
      expect(screen.queryByTestId(`frail-skill-${id}`)).toBeNull();
    }
  });

  it("shows a pending mode until it echoes", async () => {
    useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "smart" }));
    renderRail();
    fireEvent.click(screen.getByText("Strict"));
    expect(mocks.write).toHaveBeenCalledWith({
      droneId: "rail-test",
      pluginId: "com.altnautica.follow-me",
      key: "reacquire_mode",
      value: "strict",
    });
    expect(screen.getByText("Strict").getAttribute("data-pending")).toBe("true");
    expect(screen.getByText("Strict").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "strict" }));
    });
    expect(screen.getByText("Strict").getAttribute("data-pending")).toBeNull();
    expect(screen.getByText("Strict").getAttribute("aria-pressed")).toBe("true");
  });

  it("reverts and warns when no echo arrives in 3 s", async () => {
    vi.useFakeTimers();
    useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "smart" }));
    renderRail();
    fireEvent.click(screen.getByText("Strict"));
    await act(async () => {
      vi.advanceTimersByTime(FOLLOW_SETTING_ECHO_TIMEOUT_MS + 10);
    });
    expect(screen.getByText("Strict").getAttribute("data-pending")).toBeNull();
    expect(screen.getByText("Smart").getAttribute("aria-pressed")).toBe("true");
    expect(mocks.toast).toHaveBeenCalledWith(specString("follow.reacquire_not_applied"), "warning");
  });

  it("swaps the main and belly legs", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    useVideoStreamsStore.getState().setStreams(DRONE, [
      { id: "eo", index: 1, label: "eo", role: "eo", kind: "concurrent" },
      { id: "belly", index: 2, label: "belly", role: "down", kind: "concurrent" },
    ]);
    renderRail();
    const swap = screen.getByTestId("frail-camswap");
    expect(swap.textContent).toContain(specString("follow.cam_swap", { from: specString("hud.leg.eo"), to: specString("hud.leg.belly") }));
    fireEvent.click(swap);
    const st = useVideoStreamsStore.getState();
    expect(st.activeStreamIdByDrone[DRONE]).toBe("belly");
    expect(st.pipStreamIdByDrone[DRONE]).toBe("eo");
  });

  it("adds REC only where the flight screen has no right column", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderRail(false);
    expect(screen.queryByTestId("frail-rec")).toBeNull();
    cleanup();
    renderRail(true);
    expect(screen.getByTestId("frail-rec")).toBeTruthy();
  });

  it("writes when unsure through the plugin config and settles on the echo", async () => {
    useNavStreamStore.getState().setFollow(DRONE, followState({ uncertainMode: "follow" }));
    renderRail();
    const group = screen.getByTestId("follow-setting-uncertain_mode");
    expect(group.getAttribute("aria-label")).toBe(specString("follow.setting.uncertain_mode"));
    const hold = within(group).getByText(specString("follow.phase.holding"));
    expect(within(group).getByText(specString("follow.chip")).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hold);
    expect(mocks.write).toHaveBeenCalledWith({
      droneId: "rail-test",
      pluginId: "com.altnautica.follow-me",
      key: "uncertain_mode",
      value: "hold",
    });
    expect(hold.getAttribute("data-pending")).toBe("true");
    expect(hold.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      useNavStreamStore.getState().setFollow(DRONE, followState({ uncertainMode: "hold" }));
    });
    expect(hold.getAttribute("data-pending")).toBeNull();
    expect(hold.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches predictive search off through the plugin config, and reverts without an echo", async () => {
    vi.useFakeTimers();
    useNavStreamStore.getState().setFollow(DRONE, followState({ predictiveSearch: true }));
    renderRail();
    const sw = screen.getByTestId("follow-setting-predictive_search");
    expect(sw.textContent).toBe(specString("follow.setting.predictive_search"));
    expect(sw.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sw);
    expect(mocks.write).toHaveBeenCalledWith({
      droneId: "rail-test",
      pluginId: "com.altnautica.follow-me",
      key: "predictive_search",
      value: false,
    });
    expect(sw.getAttribute("aria-pressed")).toBe("false");
    expect(sw.getAttribute("data-pending")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(FOLLOW_SETTING_ECHO_TIMEOUT_MS + 10);
    });
    expect(sw.getAttribute("aria-pressed")).toBe("true");
    expect(sw.getAttribute("data-pending")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith(
      specString("flow.mode.result.failed", {
        label: specString("follow.setting.predictive_search"),
        reason: specString("setup.state.failed"),
      }),
      "warning",
    );
  });
});
