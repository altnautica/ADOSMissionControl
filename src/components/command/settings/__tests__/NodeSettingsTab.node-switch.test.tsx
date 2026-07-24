/**
 * @module command/settings/NodeSettingsTab.node-switch.test
 * @description The Settings tab renders the same field instances in place when
 * the focused node changes (the detail panel does not remount per node), so a
 * field's unsaved local draft could otherwise survive a switch and be written
 * to the wrong node on Apply. The tab keys the page body by node id so the
 * draft resets on a switch while the open sub-page stays put — this pins that.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The two-pane sidebar is irrelevant here; drop it so the only button/input in
// the tree is the field under test.
vi.mock("@/components/dashboard/node-detail/agent/NodeSubNav", () => ({
  NodeSubNav: () => null,
}));

const cfg = vi.hoisted(() => ({
  state: {
    config: null as Record<string, unknown> | null,
    loading: false,
    readOnly: false,
    accessMode: "direct",
    error: null as string | null,
    refresh: async () => {},
    setValue: (async () => {}) as (k: string, v: string) => Promise<void>,
  },
}));

vi.mock("../use-node-config", async (importOriginal) => {
  // Keep the real readConfigPath; only the hook is stubbed so the test drives
  // the loaded config + a spy writer.
  const actual = await importOriginal<typeof import("../use-node-config")>();
  return {
    ...actual,
    useNodeConfig: () =>
      cfg.state as ReturnType<typeof actual.useNodeConfig>,
  };
});

// A one-page registry that renders a real text field bound to a config key.
vi.mock("../settings-nav", async () => {
  const { ConfigTextField } = await import("../ConfigFields");
  return {
    SETTINGS_GROUPS: { system: "groups.system" },
    SETTINGS_GROUP_ORDER: ["system"],
    SETTINGS_NAV_ITEMS: [
      {
        id: "adv",
        labelKey: "adv.label",
        group: "system",
        icon: null,
        render: (ctx: {
          config: Record<string, unknown> | null;
          readOnly: boolean;
          setValue: (k: string, v: string) => Promise<void>;
        }) => (
          <ConfigTextField
            configKey="agent.board_override"
            label="Board"
            config={ctx.config}
            readOnly={ctx.readOnly}
            setValue={ctx.setValue}
          />
        ),
      },
    ],
  };
});

import { NodeSettingsTab } from "../NodeSettingsTab";

describe("NodeSettingsTab — draft does not leak across a node switch", () => {
  it("resets the field draft and never applies node A's value to node B", () => {
    const setValue = vi.fn(async () => {});
    cfg.state.setValue = setValue;
    cfg.state.config = { agent: { board_override: "node-A-value" } };

    const { rerender, container } = render(
      <NodeSettingsTab droneId="node:A" profile="drone" />,
    );
    const input = () =>
      container.querySelector("input[type=text]") as HTMLInputElement;

    expect(input().value).toBe("node-A-value");

    // Operator types an unsaved draft for node A (does NOT press Apply).
    fireEvent.change(input(), { target: { value: "typed-for-A" } });
    expect(input().value).toBe("typed-for-A");

    // Switch to node B; its config loads with a different value.
    cfg.state.config = { agent: { board_override: "node-B-value" } };
    rerender(<NodeSettingsTab droneId="node:B" profile="drone" />);

    // The field shows node B's value, NOT node A's stale draft.
    expect(input().value).toBe("node-B-value");

    // Apply is disabled (not dirty), and node A's value was never written.
    const applyBtn = container.querySelector("button") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    fireEvent.click(applyBtn);
    expect(setValue).not.toHaveBeenCalled();
  });
});
