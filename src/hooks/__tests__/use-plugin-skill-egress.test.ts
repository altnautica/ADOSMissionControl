/**
 * @license GPL-3.0-only
 *
 * Tests for the plugin-skill state egress hook. Covers:
 *   - the payload -> reported-state mapper (the honest follow.state mapping +
 *     the generic explicit-state contract)
 *   - the hook polls the LAN agent, feeds pushPluginSkillState, and
 *     republishes the raw event on the plugin event bus for a follow.state row
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as EventBus from "@/lib/plugins/event-bus";
import { renderHook, waitFor } from "@testing-library/react";

const { localPluginsRef, getStateImpl, pushSpy, publishSpy } = vi.hoisted(
  () => ({
    localPluginsRef: { value: null as unknown },
    getStateImpl: {
      value: (async () => null) as (id: string) => Promise<unknown>,
    },
    pushSpy: { fn: vi.fn() },
    publishSpy: { fn: vi.fn() },
  }),
);

vi.mock("@/hooks/use-local-agent-plugins", () => ({
  useLocalAgentPlugins: () => localPluginsRef.value,
}));
vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    constructor(
      public baseUrl: string,
      public apiKey: string,
    ) {}
    getState(id: string) {
      return getStateImpl.value(id);
    }
  },
}));
vi.mock("@/lib/plugins/event-bus", async (orig) => ({
  ...(await orig<typeof EventBus>()),
  publishPluginEvent: (...args: unknown[]) => publishSpy.fn(...args),
}));
vi.mock("@/lib/skills/plugin-skill-host-store", () => ({
  usePluginSkillHostStore: {
    getState: () => ({ pushPluginSkillState: pushSpy.fn }),
  },
}));

import {
  usePluginSkillEgress,
  mapReportedState,
} from "@/hooks/use-plugin-skill-egress";

const FOLLOW_ROW = {
  installId: "drone-1::follow",
  pluginId: "com.altnautica.follow-me",
  version: "0.1.0",
  name: "Follow-Me",
  status: "enabled",
  grantedCaps: ["ui.slot.flight-skill"],
  gcsContributes: [],
  gcsParameters: [],
  flightSkills: [{ id: "follow-me", stateTopic: "follow.state" }],
  entrypoint: "gcs/plugin.bundle.js",
  bundle: {
    kind: "agent",
    agentUrl: "http://drone-1.local:8080",
    apiKey: "key-abc",
    entrypoint: "gcs/plugin.bundle.js",
  },
};

describe("mapReportedState", () => {
  it("maps an inactive follow payload to idle", () => {
    expect(mapReportedState({ active: false })).toEqual({ state: "idle" });
  });

  it("maps a locked, commanding follow payload to active", () => {
    expect(
      mapReportedState({
        active: true,
        lock_state: "locked",
        commanding: true,
      }),
    ).toEqual({ state: "active" });
  });

  it("maps an active-but-not-commanding follow payload to active with a badge", () => {
    expect(
      mapReportedState({
        active: true,
        lock_state: "uncertain",
        commanding: false,
      }),
    ).toEqual({ state: "active", badge: "?" });
    expect(
      mapReportedState({
        active: true,
        lock_state: "lost",
        commanding: false,
      }),
    ).toEqual({ state: "active", badge: "!" });
  });

  it("honours an explicit generic state string", () => {
    expect(
      mapReportedState({ state: "disabled", reason: "x" }),
    ).toEqual({ state: "disabled", reason: "x" });
  });

  it("treats a non-object / unrecognised payload as idle", () => {
    expect(mapReportedState(null)).toEqual({ state: "idle" });
    expect(mapReportedState(42)).toEqual({ state: "idle" });
    expect(mapReportedState({ foo: "bar" })).toEqual({ state: "idle" });
  });
});

describe("usePluginSkillEgress", () => {
  beforeEach(() => {
    pushSpy.fn = vi.fn();
    publishSpy.fn = vi.fn();
    localPluginsRef.value = [FOLLOW_ROW];
    getStateImpl.value = async () => ({
      "follow.state": {
        payload: { active: true, lock_state: "locked", commanding: true },
        ts_ms: 100,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls the agent, feeds the skill store, and republishes the event", async () => {
    renderHook(() => usePluginSkillEgress("drone-1"));

    await waitFor(() => expect(pushSpy.fn).toHaveBeenCalled());
    // (1) the Skill Bar store got the mapped state for the topic + drone.
    expect(pushSpy.fn).toHaveBeenCalledWith("drone-1", "follow.state", {
      state: "active",
    });
    // (2) the raw payload was republished on the plugin event bus.
    expect(publishSpy.fn).toHaveBeenCalledWith(
      "follow.state",
      { active: true, lock_state: "locked", commanding: true },
      expect.stringMatching(/^agent-state:drone-1:/),
    );
  });

  it("is inert when there is no local plugin set (not local-first)", async () => {
    localPluginsRef.value = null;
    renderHook(() => usePluginSkillEgress("drone-1"));
    // Give a tick; nothing should be fed.
    await new Promise((r) => setTimeout(r, 20));
    expect(pushSpy.fn).not.toHaveBeenCalled();
    expect(publishSpy.fn).not.toHaveBeenCalled();
  });

  it("is inert when no drone is selected", async () => {
    renderHook(() => usePluginSkillEgress(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(pushSpy.fn).not.toHaveBeenCalled();
  });

  it("skips a plugin whose agent returns no fresh state (404 -> null)", async () => {
    getStateImpl.value = async () => null;
    renderHook(() => usePluginSkillEgress("drone-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(pushSpy.fn).not.toHaveBeenCalled();
    expect(publishSpy.fn).not.toHaveBeenCalled();
  });
});
