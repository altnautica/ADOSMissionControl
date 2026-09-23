/**
 * The install dialog end to end against the agent's plugin routes: what the
 * operator is told once the install is over, which drones get no install at
 * all, and when a failed LAN install may fall over to the cloud.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

// The persisted stores capture localStorage at import; install a working one
// before they load.
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
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
});

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
  useConvex: () => undefined,
}));
vi.mock("@/app/ConvexClientProvider", () => ({ useConvexAvailable: () => true }));

const relay = vi.hoisted(() => ({ target: null as null | { url: string; apiKey: string; relay: true } }));
vi.mock("@/components/plugins/transports/resolve-lan-url", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/plugins/transports/resolve-lan-url")>();
  return { ...real, resolveRelayTarget: () => relay.target };
});

import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import {
  RELAY_INSTALL_REFUSED,
  useInstallHandler,
  type UseInstallHandlerArgs,
} from "@/components/plugins/install-dialog/use-install-handler";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useAuthStore } from "@/stores/auth-store";
import type { InstallManifestSummary } from "@/components/plugins/install-dialog/types";

const DRONE = { _id: "row-1", deviceId: "drone-1", name: "Drone 1" };

function manifest(): InstallManifestSummary {
  return {
    pluginId: "com.example.hello",
    version: "0.1.0",
    name: "Hello",
    risk: "low",
    halves: ["agent"],
    permissions: [{ id: "telemetry.subscribe", required: true }],
    trustSignals: ["signed"],
    signatureState: "verified",
    signerId: "example-2026-A",
  } as unknown as InstallManifestSummary;
}

beforeEach(() => {
  relay.target = null;
  usePairingStore.setState({ pairedDrones: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useLocalNodesStore.setState({ nodes: [] });
});

describe("install dialog outcome", () => {
  it("tells the operator what the drone did not do after a registry install", async () => {
    useLocalNodesStore.setState({
      nodes: [{ deviceId: "drone-1", hostname: "http://192.168.1.50:8080", apiKey: "k1" }],
    } as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/plugins/install_from_url")) {
        return new Response(JSON.stringify({ ok: true, plugin_id: "com.example.hello", granted: [] }), { status: 200 });
      }
      if (url.endsWith("/enable")) {
        return new Response(JSON.stringify({ ok: false, kind: "host_io_error", detail: "unit failed" }), { status: 500 });
      }
      return new Response("{}", { status: 404 });
    }));

    renderWithIntl(
      <PluginInstallDialog
        open
        onClose={() => {}}
        targetDevice={DRONE}
        initialManifest={manifest()}
        initialManifestHash="hash"
        initialSource={{ kind: "registry", url: "https://example.com/hello.adosplug", expectedSha256: "ab".repeat(32) } as never}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Install — grants 1 permissions$/ }));

    await waitFor(() => expect(screen.getByText(/Installed on Drone 1, but not enabled yet/)).toBeTruthy());
    const notice = screen.getByRole("alert").textContent ?? "";
    expect(notice).toMatch(/did not grant: telemetry\.subscribe/);
    expect(notice).toMatch(/did not enable it/);
  });
});

describe("install routing", () => {
  function run(overrides: Partial<UseInstallHandlerArgs>) {
    const setError = vi.fn();
    const createJob = vi.fn(async () => "job-cloud");
    const args: UseInstallHandlerArgs = {
      manifest: manifest(),
      source: { kind: "file", file: new File([new Uint8Array(8)], "hello.adosplug"), manifestHash: "hash" } as never,
      granted: new Set(["telemetry.subscribe"]),
      transport: "cloud",
      lanTarget: null,
      targetDevice: DRONE,
      convexAvailable: true,
      generateUploadUrl: vi.fn(async () => "https://storage.example.com/u") as never,
      verifyArchive: vi.fn(async () => "archive-1") as never,
      createJob: createJob as never,
      storeBundle: vi.fn(async () => "bundle-1"),
      recordInstall: vi.fn(async () => "install-1"),
      grantPermission: vi.fn(async () => undefined),
      setInstallStatus: vi.fn(async () => undefined),
      manifestHash: "hash",
      onJobStarted: vi.fn(),
      onDone: vi.fn(),
      setStage: vi.fn(),
      setError,
      installInflightRef: { current: false },
      ...overrides,
    };
    const { result } = renderHook(() => useInstallHandler(args));
    return { install: result.current, setError, createJob, args };
  }

  it("refuses a signed-out file install of a Mission Control plugin it could not keep", async () => {
    useAuthStore.setState({ isAuthenticated: false });
    const onDone = vi.fn();
    const { install, setError } = run({
      manifest: { ...manifest(), halves: ["gcs"] },
      targetDevice: null,
      onDone,
    });
    await act(async () => {
      await install();
    });
    expect(setError).toHaveBeenCalledWith(expect.stringMatching(/need a cloud sign-in/));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("refuses a drone reached only over its ground station's relay", async () => {
    relay.target = { url: "http://192.168.1.60:8080/api/v1/ground-station/relay-proxy/drone-1", apiKey: "k", relay: true };
    const { install, setError, createJob } = run({});
    await act(async () => {
      await install();
    });
    expect(setError).toHaveBeenCalledWith(RELAY_INSTALL_REFUSED);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("does not fall over to the cloud for a drone the cloud cannot reach", async () => {
    // Only the drone's LAN install fails; a cloud upload would succeed, so
    // a fallback would reach createJob.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/plugins/install")
        ? new Response("down", { status: 503 })
        : new Response(JSON.stringify({ storageId: "stor-1" }), { status: 200 }),
    ));
    const { install, setError, createJob } = run({
      transport: "lan",
      lanTarget: { url: "http://192.168.1.50:8080", apiKey: "k1" },
    });
    await act(async () => {
      await install();
    });
    expect(createJob).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringMatching(/503/));
  });
});
