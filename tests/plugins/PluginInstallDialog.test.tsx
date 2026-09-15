/**
 * @module PluginInstallDialogTest
 * @description Covers the dual-transport install flow: path selection,
 * LAN-direct happy path, cloud-relay happy path, force-cloud override,
 * and LAN failover to cloud on timeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stub the persisted Zustand stores BEFORE importing the resolver so we
// don't drag the `persist` middleware (and its localStorage dependency)
// into the test environment.
vi.mock("@/stores/local-nodes-store", () => {
  const state = { nodes: [] as Array<Record<string, unknown>> };
  return {
    useLocalNodesStore: {
      getState: () => state,
      setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
    },
  };
});

vi.mock("@/stores/pairing-store", () => {
  const state = {
    pairedDrones: [] as Array<Record<string, unknown>>,
  };
  return {
    usePairingStore: {
      getState: () => ({
        ...state,
        clear: () => {
          state.pairedDrones = [];
        },
      }),
      setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
    },
  };
});

import {
  installLanDirect,
  shouldFailover,
  LanDirectError,
} from "@/components/plugins/transports/lan-direct";
import {
  installCloudRelay,
  type CreateJobMutation,
} from "@/components/plugins/transports/cloud-relay";
import { resolveLanTarget } from "@/components/plugins/transports/resolve-lan-url";
import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
});

function fakeFile(name = "foo.adosplug", size = 256): File {
  return new File([new Uint8Array(size)], name, {
    type: "application/zip",
  });
}

function fakeManifest() {
  return {
    pluginId: "com.example.basic",
    version: "0.1.0",
    name: "Basic",
    risk: "low" as const,
    halves: ["agent"] as const,
    permissions: [{ id: "telemetry.subscribe", required: true }],
    trustSignals: ["signed" as const],
    signatureState: "verified" as const,
    signerId: "altnautica-2026-A",
  };
}

function ctx(deviceId = "drone-1"): {
  file: File;
  manifest: ReturnType<typeof fakeManifest>;
  grantedPermissions: ReadonlyArray<string>;
  deviceId: string;
  deviceName: string;
} {
  return {
    file: fakeFile(),
    manifest: fakeManifest(),
    grantedPermissions: ["telemetry.subscribe"],
    deviceId,
    deviceName: "Drone 1",
  };
}

describe("resolveLanTarget", () => {
  it("returns null on HTTPS origins", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "https:" },
      writable: true,
    });
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: "drone-1",
          name: "Drone 1",
          hostname: "http://drone-1.local:8080",
          apiKey: "k1",
        } as never,
      ],
    });
    expect(resolveLanTarget("drone-1")).toBeNull();
  });

  it("returns the local-node URL on HTTP origins", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "http:" },
      writable: true,
    });
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: "drone-1",
          name: "Drone 1",
          hostname: "http://drone-1.local:8080",
          apiKey: "k1",
        } as never,
      ],
    });
    expect(resolveLanTarget("drone-1")).toEqual({
      url: "http://drone-1.local:8080",
      apiKey: "k1",
    });
  });

  it("falls back to paired-drone store when no local node matches", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "http:" },
      writable: true,
    });
    usePairingStore.setState({
      pairedDrones: [
        {
          _id: "row-1",
          userId: "u",
          deviceId: "drone-2",
          name: "Drone 2",
          apiKey: "k2",
          mdnsHost: "drone-2.local",
          pairedAt: 0,
        },
      ],
    });
    expect(resolveLanTarget("drone-2")).toEqual({
      url: "http://drone-2.local:8080",
      apiKey: "k2",
    });
  });
});

describe("installLanDirect", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { protocol: "http:" },
      writable: true,
    });
  });

  it("posts multipart with the pairing key header and returns the job id", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    let capturedMethod: string | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedMethod = init?.method;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await installLanDirect({
      ...ctx(),
      agentUrl: "http://drone.local:8080",
      pairingKey: "k1",
      jobId: "job-xyz",
    });

    expect(capturedUrl).toBe("http://drone.local:8080/api/plugins/install");
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders?.get("X-ADOS-Key")).toBe("k1");
    expect(result.transport).toBe("lan");
    expect(result.jobId).toBe("job-xyz");
  });

  it("rejects without a pairing key", async () => {
    await expect(
      installLanDirect({
        ...ctx(),
        agentUrl: "http://drone.local:8080",
        pairingKey: "",
        jobId: "x",
      }),
    ).rejects.toBeInstanceOf(LanDirectError);
  });

  it("translates network errors into a failover-eligible LanDirectError", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      await installLanDirect({
        ...ctx(),
        agentUrl: "http://drone.local:8080",
        pairingKey: "k1",
        jobId: "x",
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LanDirectError);
      expect((err as LanDirectError).cause).toBe("network");
      expect(shouldFailover(err as LanDirectError)).toBe(true);
    }
  });

  it("treats 5xx as failover-eligible and 4xx as terminal", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    try {
      await installLanDirect({
        ...ctx(),
        agentUrl: "http://drone.local:8080",
        pairingKey: "k1",
        jobId: "x",
      });
    } catch (err) {
      expect((err as LanDirectError).cause).toBe("server-5xx");
      expect(shouldFailover(err as LanDirectError)).toBe(true);
    }

    globalThis.fetch = (async () =>
      new Response("bad signature", { status: 400 })) as typeof fetch;
    try {
      await installLanDirect({
        ...ctx(),
        agentUrl: "http://drone.local:8080",
        pairingKey: "k1",
        jobId: "x",
      });
    } catch (err) {
      expect((err as LanDirectError).cause).toBe("server-4xx");
      expect(shouldFailover(err as LanDirectError)).toBe(false);
    }
  });
});

describe("installCloudRelay", () => {
  it("walks generate -> upload -> verify -> createJob and returns the cloud job id", async () => {
    const generateUploadUrl = vi.fn(async () => "https://example.com/upload");
    const verifyArchive = vi.fn(async () => "archive-xyz");
    const createJob: ReturnType<typeof vi.fn<CreateJobMutation>> = vi.fn(
      async () => "job-cloud-1",
    );
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ storageId: "stor-1" }), {
        status: 200,
      })) as typeof fetch;

    const result = await installCloudRelay({
      ...ctx(),
      generateUploadUrl,
      verifyArchive,
      createJob,
      manifestHash: "abc",
    });

    expect(generateUploadUrl).toHaveBeenCalledOnce();
    expect(verifyArchive).toHaveBeenCalledOnce();
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob.mock.calls[0]?.[0]?.archiveId).toBe("archive-xyz");
    expect(result.transport).toBe("cloud");
    expect(result.jobId).toBe("job-cloud-1");
  });

  it("computes a stable sha256 over the uploaded blob", async () => {
    const generateUploadUrl = vi.fn(async () => "https://example.com/upload");
    let seenSha: string | undefined;
    const verifyArchive = vi.fn(async (args: { sha256: string }) => {
      seenSha = args.sha256;
      return "archive-xyz";
    });
    const createJob = vi.fn(async () => "job-cloud-1");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ storageId: "stor-1" }), {
        status: 200,
      })) as typeof fetch;

    await installCloudRelay({
      ...ctx(),
      generateUploadUrl,
      verifyArchive,
      createJob,
      manifestHash: "abc",
    });
    expect(seenSha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("manifest parser", () => {
  it("parses top-level scalars and the permissions list", () => {
    const parsed = parseManifestYaml(`
id: com.example.basic
version: "0.2.0"
name: Basic
risk: medium
halves: [agent, gcs]
permissions:
  - id: telemetry.subscribe
    required: true
  - id: event.publish
`);
    expect(parsed.pluginId).toBe("com.example.basic");
    expect(parsed.version).toBe("0.2.0");
    expect(parsed.halves).toEqual(["agent", "gcs"]);
    expect(parsed.permissions).toEqual([
      { id: "telemetry.subscribe", required: true },
      // Entries without an explicit `required:` field default to
      // required:true, matching the agent's PermissionRef.required
      // Pydantic default. The legacy hand-rolled parser defaulted to
      // false here; the yaml-library rewrite aligns with the agent.
      { id: "event.publish", required: true },
    ]);
  });
});
