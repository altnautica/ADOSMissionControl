/**
 * @license GPL-3.0-only
 *
 * Tests for the live plugin contribution producer. Covers:
 *   - one contribution per matching gcsContributes entry (slot/panelId/
 *     grantedCapabilities Set / blob bundleUrl / handlers / installId)
 *   - contributions omitted until the bundle blob resolves
 *   - blob URLs revoked + handler factories disposed on unmount
 *   - slot filtering
 *   - [] when unauthenticated; only the inline fixture page in demo mode
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settings-store";
import { DEMO_INLINE_FIXTURE_PLUGIN_ID } from "@/mock/inline-fixture-plugin";

// --- Mocks ----------------------------------------------------------

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

// Mutable auth flag so the unauthenticated path is exercisable.
const { authState } = vi.hoisted(() => ({ authState: { value: true } }));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: authState.value }),
}));

const useConvexSkipQueryMock =
  vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: (...args: unknown[]) => useConvexSkipQueryMock(...args),
}));

const loadPluginBundleMock =
  vi.fn<
    (signedUrl: string) => Promise<{ blobUrl: string; revoke: () => void }>
  >();
vi.mock("@/lib/plugins/bundle-loader", () => ({
  loadPluginBundle: (signedUrl: string) => loadPluginBundleMock(signedUrl),
}));

const buildPluginHandlersMock =
  vi.fn<
    () => { handlers: Record<string, unknown>; dispose: () => void }
  >();
vi.mock("@/lib/plugins/handlers", () => ({
  buildPluginHandlers: (...args: unknown[]) =>
    buildPluginHandlersMock(...(args as [])),
}));

import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { slotToCapability } from "@/lib/plugins/types";

// --- Fixtures -------------------------------------------------------

const ROWS = [
  {
    installId: "install-1",
    pluginId: "com.example.demo",
    version: "1.0.0",
    name: "Demo Plugin",
    grantedCaps: [
      slotToCapability("video.overlay"),
      slotToCapability("node.detail.tab"),
    ],
    gcsContributes: [
      // Intentionally out of sort order so the order asc sort is observable.
      { slot: "node.detail.tab", panelId: "tab-main", order: 20 },
      { slot: "video.overlay", panelId: "overlay-main", title: "Overlay", order: 10 },
    ],
    bundleUrl: "https://signed.example/bundle.zip",
  },
];

// --------------------------------------------------------------------

describe("usePluginContributions", () => {

  beforeEach(() => {
    useSettingsStore.setState({ demoMode: false });
    authState.value = true;
    useConvexSkipQueryMock.mockReset();
    loadPluginBundleMock.mockReset();
    buildPluginHandlersMock.mockReset();
    // Sensible defaults; individual tests override as needed.
    useConvexSkipQueryMock.mockReturnValue(undefined);
    loadPluginBundleMock.mockResolvedValue({
      blobUrl: "blob:default",
      revoke: vi.fn(),
    });
    buildPluginHandlersMock.mockReturnValue({
      handlers: { ping: () => ({ ok: true }) },
      dispose: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ demoMode: false });
  });

  it("returns [] before the query resolves (skip / loading)", () => {
    useConvexSkipQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => usePluginContributions("drone-1"));
    expect(result.current).toEqual([]);
  });

  it("returns [] when unauthenticated and forwards enabled:false", () => {
    authState.value = false;
    useConvexSkipQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => usePluginContributions("drone-1"));
    expect(result.current).toEqual([]);
    const lastCall =
      useConvexSkipQueryMock.mock.calls[
        useConvexSkipQueryMock.mock.calls.length - 1
      ];
    const opts = lastCall[1] as { enabled?: boolean };
    expect(opts.enabled).toBe(false);
  });

  it("mounts no installed plugin in demo mode, only the inline fixture page", () => {
    useSettingsStore.setState({ demoMode: true });
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    const { result } = renderHook(() => usePluginContributions("drone-1"));
    expect(result.current.map((c) => [c.pluginId, c.slot, c.isolation])).toEqual([
      [DEMO_INLINE_FIXTURE_PLUGIN_ID, "node.agent.page", "inline"],
    ]);
  });

  it("produces one contribution per matching gcsContributes entry", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    const handlers = { ping: () => ({ ok: true }) };
    buildPluginHandlersMock.mockReturnValue({ handlers, dispose: vi.fn() });
    loadPluginBundleMock.mockResolvedValue({
      blobUrl: "blob:demo",
      revoke: vi.fn(),
    });

    const { result } = renderHook(() => usePluginContributions("drone-1"));
    await waitFor(() => expect(result.current.length).toBe(2));

    // Sorted by manifest order asc: video.overlay (10) before node.detail.tab (20).
    const [first, second] = result.current;
    expect(first.slot).toBe("video.overlay");
    expect(first.panelId).toBe("overlay-main");
    expect(first.title).toBe("Overlay");
    expect(first.bundleUrl).toBe("blob:demo");
    expect(first.handlers).toBe(handlers);
    expect(first.pluginInstallId).toBe("install-1");
    expect(first.grantedCapabilities).toBeInstanceOf(Set);
    expect(
      first.grantedCapabilities.has(slotToCapability("video.overlay")),
    ).toBe(true);

    expect(second.slot).toBe("node.detail.tab");
    expect(second.panelId).toBe("tab-main");
    // No manifest title falls back to the plugin's display name.
    expect(second.title).toBe("Demo Plugin");
  });

  it("omits contributions until the bundle blob loads", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    let resolveLoad!: (v: { blobUrl: string; revoke: () => void }) => void;
    loadPluginBundleMock.mockReturnValue(
      new Promise((res) => {
        resolveLoad = res;
      }),
    );

    const { result } = renderHook(() => usePluginContributions("drone-1"));
    // Blob still loading -> nothing mounts.
    expect(result.current).toEqual([]);

    await act(async () => {
      resolveLoad({ blobUrl: "blob:late", revoke: vi.fn() });
    });
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current[0].bundleUrl).toBe("blob:late");
  });

  it("revokes blob URLs and disposes handlers on unmount", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    const revoke = vi.fn();
    const dispose = vi.fn();
    loadPluginBundleMock.mockResolvedValue({ blobUrl: "blob:x", revoke });
    buildPluginHandlersMock.mockReturnValue({ handlers: {}, dispose });

    const { result, unmount } = renderHook(() =>
      usePluginContributions("drone-1"),
    );
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));

    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("filters by slot when a slot is given", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    loadPluginBundleMock.mockResolvedValue({
      blobUrl: "blob:y",
      revoke: vi.fn(),
    });

    const { result } = renderHook(() =>
      usePluginContributions("drone-1", "video.overlay"),
    );
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].slot).toBe("video.overlay");
    expect(result.current[0].panelId).toBe("overlay-main");
  });

  it("loads nothing for a slot the install does not contribute to", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    const { result } = renderHook(() =>
      usePluginContributions("drone-1", "map.overlay"),
    );
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(loadPluginBundleMock).not.toHaveBeenCalled();
    expect(buildPluginHandlersMock).not.toHaveBeenCalled();
  });

  it("shares one bundle and one handler surface across slot hosts", async () => {
    useConvexSkipQueryMock.mockReturnValue(ROWS);
    const revoke = vi.fn();
    const dispose = vi.fn();
    loadPluginBundleMock.mockResolvedValue({ blobUrl: "blob:shared", revoke });
    buildPluginHandlersMock.mockReturnValue({ handlers: {}, dispose });

    const overlay = renderHook(() =>
      usePluginContributions("drone-1", "video.overlay"),
    );
    const tab = renderHook(() =>
      usePluginContributions("drone-1", "node.detail.tab"),
    );
    await waitFor(() => expect(overlay.result.current.length).toBe(1));
    await waitFor(() => expect(tab.result.current.length).toBe(1));
    expect(loadPluginBundleMock).toHaveBeenCalledTimes(1);
    expect(buildPluginHandlersMock).toHaveBeenCalledTimes(1);
    expect(tab.result.current[0].bundleUrl).toBe("blob:shared");

    // The remaining host still holds the blob and the surface.
    overlay.unmount();
    expect(revoke).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();

    tab.unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
