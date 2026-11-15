/**
 * @license GPL-3.0-only
 *
 * The mission stall overlay: rendered from the agent's golden stall frame, it
 * reads the spec's title with the countdown and sends each button's pilot
 * action; a stall with no countdown holds for the operator, and a blocked
 * return offers Land here only. The stall and the skipped waypoint are spoken,
 * and the pilot's new banners read their spec text.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { FlightFlowOverlays, bannerText, countdownColor, voiceLine, type VoiceState } from "../FlightFlowOverlays";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { setPilotSender, type PilotOutboundFrame } from "@/lib/input/pilot-stream";
import { specString } from "@/lib/cockpit/spec-strings";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import stallFrame from "@/lib/cockpit/layers/fixtures/pilot-frame-stall.json";

const DRONE = "stall-test";

function golden(over: Record<string, unknown> = {}): PilotState {
  const raw = stallFrame as Record<string, unknown> & { data?: Record<string, unknown> };
  const pilot = parsePilotState({ ...(raw.data ?? raw), ...over });
  if (!pilot) throw new Error("golden stall frame did not parse");
  return pilot;
}

function mount(pilot: PilotState) {
  useNavStreamStore.getState().setPilot(DRONE, pilot);
  return render(
    <IntlWrapper>
      <FlightFlowOverlays droneId={DRONE} pilot={pilot} />
    </IntlWrapper>,
  );
}

function captureActions(): string[] {
  const sent: string[] = [];
  setPilotSender((f: PilotOutboundFrame) => {
    if (f.op === "action") sent.push(f.name);
    return true;
  }, DRONE);
  return sent;
}

afterEach(() => {
  setPilotSender(null);
  useNavStreamStore.getState().clear(DRONE);
});

describe("mission stall overlay", () => {
  it("reads the golden stall frame: waypoint, window and the countdown to the skip, in the critical colour", () => {
    mount(golden());
    const overlay = screen.getByTestId("mission-stall");
    expect(screen.getByTestId("mission-stall-title").textContent).toBe(
      specString("flow.mission_stall.title", { wp: "3", window_s: 15, in_s: 33 }),
    );
    expect(overlay.getAttribute("data-severity")).toBe("critical");
    expect(overlay.style.background).not.toBe("");
    expect(countdownColor("mission_stalled")).toBe(countdownColor("low_battery_rth"));
  });

  it.each([
    ["mission_skip", "flow.mission_stall.skip"],
    ["rth", "flow.mission_stall.return"],
    ["land", "flow.mission_stall.land"],
  ])("the %s button sends the pilot action %s", (action, labelKey) => {
    const sent = captureActions();
    mount(golden());
    const button = screen.getByTestId(`mission-stall-${action}`);
    expect(button.textContent).toBe(specString(labelKey));
    fireEvent.click(button);
    expect(sent).toEqual([action]);
  });

  it("holds for the operator when the stall has no countdown", () => {
    mount(golden({ mission_stall: { kind: "mission", seq: 3, wp_label: "3", since_ms: 1, skip_in_s: null, window_s: 15 } }));
    expect(screen.getByTestId("mission-stall-title").textContent).toBe(
      specString("flow.mission_stall.title_hold", { wp: "3", window_s: 15 }),
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual(
      expect.arrayContaining(["mission-stall-mission_skip", "mission-stall-rth", "mission-stall-land"]),
    );
  });

  it("a blocked return offers Land here only, and sends land", () => {
    const sent = captureActions();
    mount(golden({ mission_stall: { kind: "return", seq: null, wp_label: null, since_ms: 1, skip_in_s: 12.2, window_s: 15 } }));
    expect(screen.getByTestId("mission-stall-title").textContent).toBe(
      specString("flow.return_blocked.title", { in_s: 13 }),
    );
    expect(screen.queryByTestId("mission-stall-mission_skip")).toBeNull();
    expect(screen.queryByTestId("mission-stall-rth")).toBeNull();
    fireEvent.click(screen.getByTestId("mission-stall-land"));
    expect(sent).toEqual(["land"]);
  });

  it("shows nothing while no stall is reported", () => {
    mount(golden({ mission_stall: null }));
    expect(screen.queryByTestId("mission-stall")).toBeNull();
  });
});

describe("mission stall voice and banners", () => {
  const base: VoiceState = { owner: "pilot", fcModeName: "AUTO", mission: "active", rth: false };

  it("speaks a mission stall, a blocked return and a skipped waypoint once each", () => {
    const stall = golden().missionStall;
    expect(voiceLine(base, { ...base, missionStall: stall })).toBe(specString("voice.mission_stalled"));
    expect(voiceLine({ ...base, missionStall: stall }, { ...base, missionStall: stall })).toBeNull();
    const ret = golden({ mission_stall: { kind: "return", skip_in_s: 40, window_s: 15 } }).missionStall;
    expect(voiceLine(base, { ...base, missionStall: ret })).toBe(specString("voice.return_blocked"));
    const skipped = { textKey: "pilot.banner.mission_wp_skipped", args: { wp: "3" }, untilMs: null };
    expect(voiceLine({ ...base, missionStall: stall }, { ...base, banner: skipped })).toBe(
      specString("voice.waypoint_skipped"),
    );
    expect(voiceLine({ ...base, banner: skipped }, { ...base, banner: skipped })).toBeNull();
  });

  it.each([
    ["pilot.banner.mission_stalled", { wp: "3", in_s: 45 }, "No progress to waypoint 3 · Holding · Skipping in 45 s"],
    ["pilot.banner.mission_stalled_hold", { wp: "3" }, "No progress to waypoint 3 · Holding for you"],
    ["pilot.banner.mission_wp_skipped", { wp: "3" }, "Waypoint 3 skipped · Coverage gap saved"],
    ["pilot.banner.return_blocked", { in_s: 45 }, "Return blocked · Holding · Landing in 45 s"],
    ["pilot.banner.return_land_fallback", {}, "Flown path unavailable · Landing here"],
  ])("banner %s reads its spec text", (textKey, args, text) => {
    expect(bannerText({ textKey, args, untilMs: null })).toBe(text);
  });
});
