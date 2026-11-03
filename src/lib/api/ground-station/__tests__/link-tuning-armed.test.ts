/**
 * @license GPL-3.0-only
 *
 * Link tuning (`POST /api/video/config`) is refused by the agent while the
 * vehicle is armed. The refusal reaches the caller as `AgentArmedRefusal` so
 * the operator is asked, and the confirmed resend carries `force: true`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { setVideoConfig } from "@/lib/agent/agent-client/extras";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { linkTuningBody, setMcs } from "../wfb";

const CTX = { baseUrl: "http://agent.test", apiKey: null };
const ARMED = JSON.stringify({ error: "E_ARMED", message: "Vehicle is armed", override: "force" });

function stubFetch(status: number, body: string) {
  const fn = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("link tuning body", () => {
  it("adds the override only when the operator confirmed it", () => {
    expect(JSON.parse(linkTuningBody({ mcs: 3 }))).toEqual({ mcs: 3 });
    expect(JSON.parse(linkTuningBody({ mcs: 3 }, { force: false }))).toEqual({ mcs: 3 });
    expect(JSON.parse(linkTuningBody({ mcs: 3 }, { force: true }))).toEqual({ mcs: 3, force: true });
  });
});

describe("armed refusal", () => {
  it("surfaces the ground-station tuning refusal as AgentArmedRefusal", async () => {
    stubFetch(409, ARMED);
    await expect(setMcs(CTX, 3)).rejects.toBeInstanceOf(AgentArmedRefusal);
  });

  it("rethrows the refusal from the agent client instead of swallowing it", async () => {
    stubFetch(409, ARMED);
    await expect(setVideoConfig(CTX, { auto: true })).rejects.toBeInstanceOf(AgentArmedRefusal);
  });

  it("still reads any other failure as null, and sends force on the confirmed retry", async () => {
    stubFetch(500, "{}");
    await expect(setVideoConfig(CTX, { tier_idx: 1 })).resolves.toBeNull();
    const fetch = stubFetch(200, "{}");
    await setVideoConfig(CTX, { tier_idx: 1 }, { force: true });
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ tier_idx: 1, force: true });
  });
});
