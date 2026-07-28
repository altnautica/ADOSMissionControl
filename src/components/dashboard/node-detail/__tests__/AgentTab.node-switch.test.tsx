/**
 * @module node-detail/AgentTab.node-switch.test
 * @description The Agent page renders the same field instances in place when the
 * focused node changes (the detail panel does not remount per node), so a config
 * field's unsaved local draft could otherwise survive a switch and be written to
 * the wrong node on Apply. The page keys the active configuration body by node id
 * so the draft resets on a switch while the open sub-page stays put — this pins
 * that. It moved here with the config pages when the Agent page's third sidebar
 * was flattened away.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// The persisted ui-prefs store captures its storage at import, and happy-dom's
// localStorage.setItem is not a function here — install a working one first.
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The sidebar and the no-companion showcase are irrelevant here; drop them so
// the only button/input in the tree belongs to the field under test.
vi.mock("../agent/NodeSubNav", () => ({ NodeSubNav: () => null }));
vi.mock("../agent/AgentShowcase", () => ({ AgentShowcase: () => null }));

// No live surfaces: the merged sidebar then resolves to the single config page
// below, which is the one carrying the field.
vi.mock("../agent/agent-nav-items", () => ({
  AGENT_NAV_ITEMS: [],
  companionPresent: () => true,
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

vi.mock(
  "@/components/command/settings/use-node-config",
  async (importOriginal) => {
    // Keep the real readConfigPath; only the hook is stubbed so the test drives
    // the loaded config + a spy writer.
    const actual = await importOriginal<typeof UseNodeConfig>();
    return {
      ...actual,
      useNodeConfig: () => cfg.state as NodeConfig,
    };
  },
);

// A one-page registry that renders a real text field bound to a config key. The
// id must be one the merged section table places, or the page would not resolve.
// The field component is pulled in dynamically because this factory is hoisted
// above the import block: a static binding would still be in its TDZ here.
vi.mock("@/components/command/settings/settings-nav", async () => {
  const { ConfigTextField } = await import(
    "@/components/command/settings/ConfigFields"
  );
  return {
    SETTINGS_NAV_ITEMS: [
      {
        id: "advanced",
        labelKey: "adv.label",
        icon: null,
        readsConfig: true,
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

import { AgentTab } from "../agent/AgentTab";
import type { SurfaceContext } from "../surface-types";
import type * as UseNodeConfig from "@/components/command/settings/use-node-config";
import type { NodeConfig } from "@/components/command/settings/use-node-config";

function ctxFor(droneId: string): SurfaceContext {
  return {
    droneId,
    drone: { profile: "drone" } as SurfaceContext["drone"],
    displayName: droneId,
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: false,
    visionPresent: false,
    crsfPresent: false,
    role: "drone" as SurfaceContext["role"],
    showLockedTabs: false,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
  };
}

describe("AgentTab — a config draft does not leak across a node switch", () => {
  it("resets the field draft and never applies node A's value to node B", () => {
    const setValue = vi.fn(async () => {});
    cfg.state.setValue = setValue;
    cfg.state.config = { agent: { board_override: "node-A-value" } };

    const { rerender, container } = render(<AgentTab ctx={ctxFor("node:A")} />);
    const input = () =>
      container.querySelector("input[type=text]") as HTMLInputElement;

    expect(input().value).toBe("node-A-value");

    // Operator types an unsaved draft for node A (does NOT press Apply).
    fireEvent.change(input(), { target: { value: "typed-for-A" } });
    expect(input().value).toBe("typed-for-A");

    // Switch to node B; its config loads with a different value.
    cfg.state.config = { agent: { board_override: "node-B-value" } };
    rerender(<AgentTab ctx={ctxFor("node:B")} />);

    // The field shows node B's value, NOT node A's stale draft.
    expect(input().value).toBe("node-B-value");

    // Apply is disabled (not dirty), and node A's value was never written.
    const applyBtn = container.querySelector("button") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    fireEvent.click(applyBtn);
    expect(setValue).not.toHaveBeenCalled();
  });
});
