/**
 * @license GPL-3.0-only
 *
 * Render-stability tests for the live plugin contribution producer. A
 * LAN-paired node that reports no plugins must settle after the node answers:
 * the producer re-renders a bounded number of times and never trips React's
 * update-depth guard, whether the empty result reaches it as one stable array
 * or as a fresh empty array on every render.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { listCalls, freshEmptyLocal } = vi.hoisted(() => ({
  listCalls: { value: 0 },
  freshEmptyLocal: { value: false },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: false }),
}));
vi.mock("@/stores/local-nodes-store", () => {
  const nodes = [
    { deviceId: "drone-1", hostname: "http://drone-1.local:8080", apiKey: "key-abc" },
  ];
  return {
    useLocalNodesStore: (sel: (s: { nodes: unknown[] }) => unknown) => sel({ nodes }),
  };
});
vi.mock("@/stores/local-plugin-installs-store", () => {
  const installs: unknown[] = [];
  return {
    useLocalPluginInstallsStore: (sel: (s: { installs: unknown[] }) => unknown) =>
      sel({ installs }),
  };
});
vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    list() {
      listCalls.value += 1;
      return Promise.resolve({ installs: [] });
    }
    get() {
      return Promise.reject(new Error("no plugin"));
    }
  },
}));
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("convex/react", () => {
  const convex = { query: () => Promise.resolve(null) };
  return { useConvex: () => convex };
});
vi.mock("next-intl", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
// The real local source by default; a fresh empty array per render when the
// test asks for an upstream that does not hold its identity.
vi.mock("@/hooks/use-local-agent-plugins", async (orig) => {
  const actual = await orig<typeof import("@/hooks/use-local-agent-plugins")>();
  return {
    ...actual,
    useLocalAgentPlugins: (deviceId: string | null) => {
      const real = actual.useLocalAgentPlugins(deviceId);
      return freshEmptyLocal.value ? [] : real;
    },
  };
});

import { usePluginContributions } from "@/hooks/use-plugin-contributions";

const RENDER_BUDGET = 10;

function flush() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 50);
  return act(() => promise);
}

/** Render the producer for a paired node, let the node answer, and require
 * the host to stop re-rendering within a small budget. */
async function expectSettles(errorSpy: MockInstance<(typeof console)["error"]>) {
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    // Stop a runaway loop here so a regression fails instead of hanging.
    if (renders > 200) throw new Error("render loop");
    return usePluginContributions("drone-1");
  });
  await waitFor(() => expect(listCalls.value).toBeGreaterThan(0));
  // Let the node's answer and any effects it triggers flush.
  await flush();
  const settled = renders;
  await flush();
  expect(renders).toBe(settled);
  expect(settled).toBeLessThan(RENDER_BUDGET);
  expect(result.current).toHaveLength(0);
  const depthErrors = errorSpy.mock.calls.filter((args) =>
    String(args[0]).includes("Maximum update depth"),
  );
  expect(depthErrors).toEqual([]);
}

describe("usePluginContributions render stability", () => {
  let errorSpy: MockInstance<(typeof console)["error"]>;

  beforeEach(() => {
    listCalls.value = 0;
    freshEmptyLocal.value = false;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("settles once a paired node reports no plugins", async () => {
    await expectSettles(errorSpy);
  });

  it("settles when the upstream source hands back a fresh empty array each render", async () => {
    freshEmptyLocal.value = true;
    await expectSettles(errorSpy);
  });
});

