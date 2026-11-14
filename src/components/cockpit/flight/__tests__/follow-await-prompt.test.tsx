/**
 * @module follow-await-prompt.test
 * @description The waiting-for-instructions prompt: shown only while a fresh
 * follow report holds for the operator, with the body and actions the shared
 * rule picks; each button and each bare key runs its transport (search again
 * and stop write the follow-me config, return home and land dispatch the
 * built-ins, pick a target drops the designation).
 * @license GPL-3.0-only
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => vi.fn(async (_input: { droneId: string; pluginId: string; key: string; value: unknown }) => true));
const flights = vi.hoisted(() => vi.fn(async (_id: string, _ctx: unknown) => {}));

vi.mock("@/lib/skills/plugin-config-writer", () => ({ writePluginConfigValue: writes }));
vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activateBound: flights,
  buildSkillContext: (droneId: string) => ({ droneId }),
}));

import { FollowAwaitPrompt } from "@/components/cockpit/flight/FollowAwaitPrompt";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { specString } from "@/lib/cockpit/spec-strings";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { followState } from "../../__tests__/follow-fixtures";

const DRONE = "node:prompt-test";

function awaiting(over: Parameters<typeof followState>[0] = {}, ageMs = 0) {
  useNavStreamStore
    .getState()
    .setFollow(
      DRONE,
      followState({ phase: "holding-await-operator", holdReason: "search-exhausted", operatorResumeSeq: 4, ...over }),
      Date.now() - ageMs,
    );
}

function actions(): string[] {
  return Array.from(document.querySelectorAll("[data-action]")).map((b) => b.getAttribute("data-action") ?? "");
}

describe("FollowAwaitPrompt", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    writes.mockClear();
    flights.mockClear();
  });
  afterEach(cleanup);

  it("is absent while following, searching or with a stale report", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState({ phase: "searching", reacquireRemainingS: 5 }));
    const { container, unmount } = render(<FollowAwaitPrompt droneId={DRONE} />);
    expect(container.firstChild).toBeNull();
    unmount();
    awaiting({}, 5000);
    expect(render(<FollowAwaitPrompt droneId={DRONE} />).container.firstChild).toBeNull();
  });

  it("names why it waits and offers every action, taking focus", () => {
    awaiting();
    render(<FollowAwaitPrompt droneId={DRONE} />);
    const prompt = screen.getByTestId("follow-await-prompt");
    expect(prompt.getAttribute("role")).toBe("alert");
    expect(prompt.textContent).toContain(specString("follow.prompt.await_title"));
    expect(prompt.textContent).toContain(specString("follow.prompt.await_body.search_exhausted"));
    expect(actions()).toEqual(["resume", "redesignate", "rth", "land", "stop"]);
    expect(screen.getByRole("button", { name: /Search again/ }).getAttribute("aria-keyshortcuts")).toBe("R");
    expect(document.activeElement).toBe(prompt);
  });

  it("offers no search again in strict re-acquire", () => {
    awaiting({ reacquireMode: "strict", holdReason: "awaiting-operator" });
    render(<FollowAwaitPrompt droneId={DRONE} />);
    expect(actions()).toEqual(["redesignate", "rth", "land", "stop"]);
  });

  it("search again and stop write the follow-me config", async () => {
    awaiting();
    render(<FollowAwaitPrompt droneId={DRONE} />);
    fireEvent.click(screen.getByRole("button", { name: /Search again/ }));
    fireEvent.click(screen.getByRole("button", { name: /Stop following/ }));
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
    expect(writes).toHaveBeenNthCalledWith(1, { droneId: "prompt-test", pluginId: FOLLOW_ME_PLUGIN_ID, key: "operator_resume_seq", value: 5 });
    expect(writes).toHaveBeenNthCalledWith(2, { droneId: "prompt-test", pluginId: FOLLOW_ME_PLUGIN_ID, key: "active", value: false });
  });

  it("return home and land dispatch the built-ins; pick a target drops the designation", async () => {
    awaiting();
    useSelectedTargetStore.getState().setDesignated({
      droneId: DRONE,
      cameraId: "main",
      trackId: 15,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      classLabel: "person",
      confidence: 0.9,
    });
    render(<FollowAwaitPrompt droneId={DRONE} />);
    fireEvent.click(screen.getByRole("button", { name: /Return home/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Land/ }));
    await waitFor(() => expect(flights).toHaveBeenCalledTimes(2));
    expect(flights.mock.calls.map((c) => c[0])).toEqual(["rth", "land"]);
    fireEvent.click(screen.getByRole("button", { name: /Pick a target/ }));
    expect(useSelectedTargetStore.getState().designated).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });

  it("answers bare keys while focused, never a modified chord", async () => {
    awaiting();
    render(<FollowAwaitPrompt droneId={DRONE} />);
    const prompt = screen.getByTestId("follow-await-prompt");
    fireEvent.keyDown(prompt, { key: "r", shiftKey: true });
    fireEvent.keyDown(prompt, { key: "x", ctrlKey: true });
    expect(writes).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "h" });
    fireEvent.keyDown(prompt, { key: "r" });
    await waitFor(() => expect(writes).toHaveBeenCalledOnce());
    expect(flights.mock.calls.map((c) => c[0])).toEqual(["rth"]);
    expect(writes.mock.calls[0][0]).toMatchObject({ key: "operator_resume_seq", value: 5 });
  });
});
