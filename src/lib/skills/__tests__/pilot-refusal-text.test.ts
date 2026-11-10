/**
 * A pilot action the drone refuses reaches the operator as the cockpit spec's
 * text for the refusal code, never as the bare code: a known code reads its
 * `refusal.*` sentence, `not_ready:<id>` names the readiness item, an unknown
 * code is shown as sent, and the codes this client makes up itself (no pilot
 * link, no answer) read through the same table.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import strings from "@/lib/cockpit-spec/setup-strings.json";
import { PILOT_NO_ANSWER, type PilotActionOutcome } from "@/lib/input/pilot-stream";
import type * as PilotStreamModule from "@/lib/input/pilot-stream";
import { pilotActionResult } from "@/lib/skills/builtins/_shared";

const { answer } = vi.hoisted(() => ({
  answer: { current: null as PilotActionOutcome | null },
}));

vi.mock("@/lib/input/pilot-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof PilotStreamModule>();
  return {
    ...actual,
    requestPilotAction: (...args: Parameters<typeof actual.requestPilotAction>) =>
      answer.current ? Promise.resolve(answer.current) : actual.requestPilotAction(...args),
  };
});

const TEXT = strings.strings as Record<string, string>;

function refuseWith(err: string | undefined): void {
  answer.current = err === undefined ? { ok: false } : { ok: false, err };
}

afterEach(() => {
  answer.current = null;
});

describe("pilot action refusals", () => {
  it("reads a known code as the spec's sentence", async () => {
    refuseWith("not_armed");
    const r = await pilotActionResult("goto", { lat: 1, lon: 2, alt_m: 10 });
    expect(r.success).toBe(false);
    expect(r.message).toBe(TEXT["refusal.not_armed"]);
  });

  it("shows an unknown code as sent, inside the spec's unknown text", async () => {
    refuseWith("warp_core_offline");
    const r = await pilotActionResult("arm");
    expect(r.message).toBe(TEXT["refusal.unknown"].replace("{code}", "warp_core_offline"));
  });

  it("names the readiness item of a not_ready refusal", async () => {
    refuseWith("not_ready:position");
    const r = await pilotActionResult("launch", { after: "hold", alt_m: 3 });
    expect(r.message).toBe(TEXT["refusal.not_ready"].replace("{item}", TEXT["readiness.item.position"]));
  });

  it("reads a refusal with no code as the spec's plain refusal", async () => {
    refuseWith(undefined);
    const r = await pilotActionResult("land");
    expect(r.message).toBe(TEXT["refusal.none"]);
  });

  it("reads a send with no pilot stream as the spec's no-link text", async () => {
    const r = await pilotActionResult("rth");
    expect(r.success).toBe(false);
    expect(r.message).toBe(TEXT["refusal.no_pilot_link"]);
  });

  it("keeps the flight-controller fallback when the pilot gives no answer", async () => {
    refuseWith(PILOT_NO_ANSWER);
    const fallback = { success: true, resultCode: 0, message: "" };
    const r = await pilotActionResult("rth", undefined, () => Promise.resolve(fallback));
    expect(r).toBe(fallback);
  });

  it("reads no answer as the spec's no-response text when there is no fallback", async () => {
    refuseWith(PILOT_NO_ANSWER);
    const r = await pilotActionResult("pause");
    expect(r.message).toBe(TEXT["refusal.no_response"]);
  });
});
