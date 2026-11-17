/**
 * @license GPL-3.0-only
 *
 * The no-RC declaration on the pilot state: `rc_receiver` is read where
 * `place_class` is, the new refusals read their `refusal.<err>` sentence and
 * the new readiness ids their `readiness.item.<id>` label, and the cockpit
 * top bar shows the "No RC" chip only while declared.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import strings from "@/lib/cockpit-spec/setup-strings.json";
import { NoRcChip } from "@/components/cockpit/flight/NoRcChip";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const TEXT = strings.strings as Record<string, string>;
const DRONE = "no-rc-chip";

function state(over: Record<string, unknown> = {}): PilotState {
  const p = parsePilotState({ owner: "idle", ...over });
  if (!p) throw new Error("pilot state did not parse");
  return p;
}

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
});

describe("rc_receiver on the pilot state", () => {
  it("reads absent only when declared, and the link-loss window when reported", () => {
    expect(state({ rc_receiver: "absent", link_loss_s: 12 })).toMatchObject({ rcReceiver: "absent", linkLossS: 12 });
    expect(state({ rc_receiver: "present" }).rcReceiver).toBe("present");
    expect(state()).toMatchObject({ rcReceiver: "present", linkLossS: null });
  });
});

describe("no-RC refusals and readiness labels", () => {
  it.each(["armed", "control_mode", "firmware", "confined", "rc_receiver_absent", "link_loss_unrecovered"])(
    "refusal %s reads its spec sentence",
    (err) => {
      expect(TEXT[`refusal.${err}`]).toBeTruthy();
      expect(refusalText(err)).toBe(TEXT[`refusal.${err}`]);
    },
  );

  it.each(["rc_receiver", "rc_seen", "link_loss_posture"])("readiness item %s is named by its label", (id) => {
    expect(TEXT[`readiness.item.${id}`]).toBeTruthy();
    expect(refusalText(`not_ready:${id}`)).toBe(TEXT["refusal.not_ready"].replace("{item}", TEXT[`readiness.item.${id}`]));
  });
});

describe("No RC chip", () => {
  it("shows while declared, with the posture line", () => {
    useNavStreamStore.getState().setPilot(DRONE, state({ rc_receiver: "absent", link_loss_action: "rth" }));
    render(<NoRcChip droneId={DRONE} />);
    const chip = screen.getByTestId("no-rc-chip");
    expect(chip.textContent).toBe(TEXT["chip.no_rc"]);
    expect(chip.getAttribute("title")).toBe(
      TEXT["follow.no_rc_strip"].replace("{action}", TEXT["pilot.link_loss_action.rth"]).replace("{s}", "10"),
    );
  });

  it("is absent with an RC transmitter", () => {
    useNavStreamStore.getState().setPilot(DRONE, state({ rc_receiver: "present" }));
    render(<NoRcChip droneId={DRONE} />);
    expect(screen.queryByTestId("no-rc-chip")).toBeNull();
  });
});
