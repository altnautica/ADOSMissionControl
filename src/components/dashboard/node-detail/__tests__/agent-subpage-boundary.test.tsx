/**
 * @module node-detail/agent-subpage-boundary.test
 * @description One error boundary used to wrap the WHOLE Agent tab, so the
 * sidebar was a child of the thing that threw: any render error in one
 * sub-page replaced the entire configuration surface — navigation included —
 * with a generic card. With the sidebar gone the operator could not navigate
 * to a working page, and "Try again" re-mounted the same failing page.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
});

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/command/settings/use-node-config", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useNodeConfig: () => ({
    config: {},
    loading: false,
    readOnly: false,
    error: null,
    setValue: async () => {},
  }),
}));

// Two live pages, one of which throws on render.
vi.mock("../agent/agent-nav-items", () => ({
  companionPresent: () => true,
  AGENT_NAV_ITEMS: [
    {
      id: "system",
      labelKey: "health",
      icon: null,
      render: () => {
        throw new Error("sub-page blew up");
      },
    },
    {
      id: "plugins",
      labelKey: "extensions",
      icon: null,
      render: () => <div>extensions-body</div>,
    },
  ],
}));
vi.mock("@/components/command/settings/settings-nav", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  SETTINGS_NAV_ITEMS: [],
}));

import { AgentTab } from "../agent/AgentTab";
import type { SurfaceContext } from "../surface-types";

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
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent: "absent",
    role: null,
    capabilitiesKnown: true,
    showLockedTabs: false,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The boundary logs for developer triage; React also logs the caught error.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

describe("a throwing Agent sub-page", () => {
  it("leaves the sidebar rendered and the other pages reachable", () => {
    const { container, getByText, queryByText } = render(
      <AgentTab ctx={ctxFor("node:d1")} />,
    );

    // The failing page shows the fallback...
    expect(getByText("dronePanel.surfaceError")).toBeTruthy();
    // ...and the sidebar is still there, with both rows.
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(getByText("health")).toBeTruthy();
    expect(getByText("extensions")).toBeTruthy();

    // Navigating away from the broken page works and clears the fallback.
    fireEvent.click(getByText("extensions"));
    expect(getByText("extensions-body")).toBeTruthy();
    expect(queryByText("dronePanel.surfaceError")).toBeNull();
  });
});
