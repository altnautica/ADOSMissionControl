/**
 * @license GPL-3.0-only
 *
 * The Tweak panel picks each control from the manifest schema (an enum is a
 * segmented choice, a number a stepper even before any value is cached),
 * steps and clamps a number inside its bounds, records a value only after
 * the agent accepts it and says so when it refuses, and words labels and
 * options from the extension's locale bundle.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

const mocks = vi.hoisted(() => ({
  params: [] as unknown[],
  write: vi.fn(async (..._a: unknown[]) => true),
  bundle: {} as Record<string, string>,
}));

vi.mock("@/lib/skills/plugin-config-writer", () => ({ writePluginConfigValue: mocks.write }));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginParameters: () => mocks.params,
}));
vi.mock("@/lib/plugins/node-agent-reach", async (orig) => ({
  ...(await orig<typeof import("@/lib/plugins/node-agent-reach")>()),
  resolveNodeAgentReach: () => ({ hostUrl: "http://agent.test", peerDeviceId: null }),
}));
vi.mock("@/lib/plugins/plugin-locale", () => ({
  loadPluginLocale: async () => mocks.bundle,
}));

import messages from "../../../../locales/en.json";
import { SkillTweakPanel, stepValue } from "@/components/cockpit/v2/SkillTweakPanel";
import { pluginConfigKey, usePluginConfigCache } from "@/lib/plugins/config-cache";
import type { Skill } from "@/lib/skills";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";

const DRONE = "node:tweak-dev";
const PLUGIN = "com.example.follow";
const SKILL = { id: `${PLUGIN}:follow`, pluginId: PLUGIN, params: ["follow_distance_m", "follow_mode"] } as unknown as Skill;
const DIST: PluginParameter = {
  key: "follow_distance_m",
  schema: { type: "number", minimum: 3, maximum: 30, step: 0.5, default: 8 },
  ui: { label: "settings.followDistance" },
};
const MODE: PluginParameter = {
  key: "follow_mode",
  schema: { type: "string", enum: ["chase", "orbit"], default: "chase" },
  ui: { label: "settings.followMode" },
};

async function mount(notify = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SkillTweakPanel droneId={DRONE} skill={SKILL} active={false} starting={false} onGo={() => {}} onStop={() => {}} notify={notify} />
    </NextIntlClientProvider>,
  );
  await act(async () => {});
  return notify;
}

const cached = () => usePluginConfigCache.getState().values[pluginConfigKey("tweak-dev", PLUGIN)];

beforeEach(() => {
  mocks.params = [{ installId: "i1", pluginId: PLUGIN, title: "Follow", parameters: [DIST, MODE] }];
  mocks.bundle = {
    "settings.followDistance": "Follow distance",
    "settings.followMode": "Follow mode",
    "follow_mode.orbit": "Orbit",
  };
  mocks.write.mockReset();
  mocks.write.mockImplementation(async () => true);
});

afterEach(() => {
  cleanup();
  usePluginConfigCache.setState({ values: {} } as never);
});

describe("Tweak panel controls from the manifest schema", () => {
  it("shows a stepper and a segmented choice with nothing cached yet", async () => {
    await mount();
    expect(document.querySelector("[data-param='follow_distance_m']")?.getAttribute("data-widget")).toBe("number");
    expect(screen.getByRole("button", { name: "Follow distance +" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Follow mode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Orbit" })).toBeTruthy();
  });

  it("steps by the schema step and never past its bounds", () => {
    expect(stepValue(DIST, 8, 1)).toBe(8.5);
    expect(stepValue(DIST, 3, -1)).toBe(3);
    expect(stepValue(DIST, 30, 1)).toBe(30);
  });

  it("records a value only once the agent accepts it", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Follow distance +" }));
    });
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ key: "follow_distance_m", value: 8.5 }));
    expect(cached()?.follow_distance_m).toBe(8.5);
  });

  it("keeps the shown value and says so when the agent refuses", async () => {
    mocks.write.mockImplementation(async () => false);
    const notify = await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Orbit" }));
    });
    expect(cached()?.follow_mode).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(messages.plugins.parameters.agentUnreachable);
  });
});
