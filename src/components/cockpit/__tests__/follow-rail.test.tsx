import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { useSkillRegistry } from "@/lib/skills";
import { FollowRail } from "@/components/cockpit/FollowRail";
import { FOLLOW_SKILL_ID } from "@/hooks/use-following-mode";
import { REACQUIRE_ECHO_TIMEOUT_MS, useReacquirePendingStore } from "@/hooks/use-reacquire-mode";
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

function renderRail(widthClass: CockpitWidthClass = "expanded", height = 720) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitLayoutContext.Provider value={{ widthClass, width: 1280, height }}>
        <FollowRail droneId={DRONE} />
      </CockpitLayoutContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("FollowRail", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useSelectedTargetStore.setState({ designated: null });
    useReacquirePendingStore.setState({ byDrone: {} });
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
    expect(btn.textContent).toContain("FOLLOW ▸");
    fireEvent.click(btn);
    expect(mocks.activateBound).toHaveBeenCalledWith(FOLLOW_SKILL_ID, { droneId: DRONE });
  });

  it("reads TRACKING while following and mirrors HOLD / RTL / LAND at expanded only", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    setSkills([FOLLOW_SKILL_ID, "pause", "rth", "land"], { land: "disabled" });
    renderRail("expanded");
    expect(screen.getByTestId("frail-follow").textContent).toContain("TRACKING ×");
    fireEvent.click(screen.getByTestId("frail-skill-rth"));
    expect(mocks.activateBound).toHaveBeenCalledWith("rth", { droneId: DRONE });
    // A disabled skill stays disabled on its mirror.
    fireEvent.click(screen.getByTestId("frail-skill-land"));
    expect(mocks.activateBound).not.toHaveBeenCalledWith("land", expect.anything());
    cleanup();
    renderRail("medium");
    expect(screen.queryByTestId("frail-skill-rth")).toBeNull();
  });

  it("shows a pending mode until it echoes", async () => {
    useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "smart" }));
    renderRail();
    fireEvent.click(screen.getByText("STRICT"));
    expect(mocks.write).toHaveBeenCalledWith({
      droneId: "rail-test",
      pluginId: "com.altnautica.follow-me",
      key: "reacquire_mode",
      value: "strict",
    });
    expect(screen.getByText("STRICT").getAttribute("data-pending")).toBe("true");
    expect(screen.getByText("STRICT").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "strict" }));
    });
    expect(screen.getByText("STRICT").getAttribute("data-pending")).toBeNull();
    expect(screen.getByText("STRICT").getAttribute("aria-pressed")).toBe("true");
  });

  it("reverts and warns when no echo arrives in 3 s", async () => {
    vi.useFakeTimers();
    useNavStreamStore.getState().setFollow(DRONE, followState({ reacquireMode: "smart" }));
    renderRail();
    fireEvent.click(screen.getByText("STRICT"));
    await act(async () => {
      vi.advanceTimersByTime(REACQUIRE_ECHO_TIMEOUT_MS + 10);
    });
    expect(screen.getByText("STRICT").getAttribute("data-pending")).toBeNull();
    expect(screen.getByText("SMART").getAttribute("aria-pressed")).toBe("true");
    expect(mocks.toast).toHaveBeenCalledWith(messages.hud.rail.modeNotApplied, "warning");
  });

  it("swaps the main and belly legs", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    useVideoStreamsStore.getState().setStreams(DRONE, [
      { id: "eo", index: 1, label: "eo", role: "eo", kind: "concurrent" },
      { id: "belly", index: 2, label: "belly", role: "down", kind: "concurrent" },
    ]);
    renderRail();
    const swap = screen.getByTestId("frail-camswap");
    expect(swap.textContent).toContain("EO Zoom ⇄ Belly");
    fireEvent.click(swap);
    const st = useVideoStreamsStore.getState();
    expect(st.activeStreamIdByDrone[DRONE]).toBe("belly");
    expect(st.pipStreamIdByDrone[DRONE]).toBe("eo");
  });

  it("folds CAM and REC behind ⋯ on a short compact cockpit", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderRail("compact", 400);
    expect(screen.queryByTestId("frail-rec")).toBeNull();
    fireEvent.click(screen.getByTestId("frail-more"));
    expect(screen.getByTestId("frail-rec")).toBeTruthy();
    cleanup();
    renderRail("compact", 720);
    expect(screen.queryByTestId("frail-more")).toBeNull();
    expect(screen.getByTestId("frail-rec")).toBeTruthy();
  });
});
