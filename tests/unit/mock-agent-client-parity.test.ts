/**
 * Demo mode swaps `MockAgentClient` in for `AgentClient` behind a cast, so a
 * method the real client gains and the mock lacks compiles cleanly and then
 * throws "is not a function" the first time a demo screen calls it. This pins
 * the public method surface of the two together (checked by the typecheck
 * gate) and confirms the demo answers are the "not reported" shapes.
 */

import { describe, expect, expectTypeOf, it } from "vitest";

import type { AgentClient } from "@/lib/agent/client";
import { MockAgentClient } from "@/mock/mock-agent";

type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

describe("MockAgentClient parity", () => {
  it("carries every public AgentClient method", () => {
    expectTypeOf<
      Exclude<MethodKeys<AgentClient>, keyof MockAgentClient>
    >().toEqualTypeOf<never>();
  });

  it("answers unsupported reads as not reported, never as readings", async () => {
    const mock = new MockAgentClient();
    await expect(mock.getVersion()).resolves.toBeNull();
    await expect(mock.supports("anything")).resolves.toBe(false);
    await expect(mock.getFullStatus()).resolves.toBeNull();
    await expect(mock.getVideoStatus()).resolves.toBeNull();
    await expect(mock.getTime()).resolves.toBeNull();
  });

  it("tracks a demo recording from start to stop", async () => {
    const mock = new MockAgentClient();
    const started = await mock.startRecording();
    const during = await mock.listRecordings();
    expect(during.recording).toBe(true);
    expect(during.current_filename).toBe(started.filename);
    const stopped = await mock.stopRecording();
    expect(stopped.filename).toBe(started.filename);
    expect((await mock.listRecordings()).recording).toBe(false);
  });
});
