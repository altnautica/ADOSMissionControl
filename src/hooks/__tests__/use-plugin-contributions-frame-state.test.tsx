/**
 * @license GPL-3.0-only
 *
 * An iframe extension whose bundle has not arrived is listed with its load
 * state instead of being dropped: loading while the fetch runs, and the error
 * with a retry when it fails. Dropping it left the tab blank with no reason.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { acquire } = vi.hoisted(() => ({
  acquire: { reject: false },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));
const ROWS = [
  {
    installId: "inst-1",
    pluginId: "com.example.frame",
    version: "1.0.0",
    name: "Frame Ext",
    grantedCaps: [],
    gcsContributes: [{ slot: "node.detail.tab", panelId: "tab", title: "Frame Ext" }],
    gcsIsolation: "iframe",
    bundleUrl: "https://bundles.example.com/frame.js",
  },
];
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => ROWS }));
vi.mock("@/hooks/use-local-agent-plugins", () => ({ useLocalAgentPlugins: () => null }));
vi.mock("convex/react", () => {
  const convex = { query: () => Promise.resolve(null) };
  return { useConvex: () => convex };
});
vi.mock("next-intl", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("@/lib/plugins/handlers", () => ({
  buildPluginHandlers: () => ({ handlers: {}, dispose: () => {} }),
}));
vi.mock("@/hooks/plugin-contribution-cache", async (orig) => {
  const actual = await orig<typeof import("@/hooks/plugin-contribution-cache")>();
  return {
    ...actual,
    acquireBundle: () =>
      acquire.reject ? Promise.reject(new Error("timed out")) : new Promise(() => {}),
    peekBundle: () => undefined,
    releaseBundle: () => {},
  };
});

import { usePluginContributions } from "@/hooks/use-plugin-contributions";

describe("usePluginContributions iframe load state", () => {
  it("lists a loading iframe with its loading state", async () => {
    acquire.reject = false;
    const { result } = renderHook(() => usePluginContributions("drone-1", "node.detail.tab"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].frame).toEqual({ status: "loading" });
    expect(result.current[0].bundleUrl).toBe("");
  });

  it("lists a failed iframe bundle with the error and a retry", async () => {
    acquire.reject = true;
    const { result } = renderHook(() => usePluginContributions("drone-2", "node.detail.tab"));
    await waitFor(() => expect(result.current[0]?.frame?.status).toBe("error"));
    const frame = result.current[0].frame;
    expect(frame && frame.status === "error" && frame.message).toBe("timed out");
    expect(frame && frame.status === "error" && typeof frame.retry).toBe("function");
  });
});
