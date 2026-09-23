/**
 * @license GPL-3.0-only
 *
 * Coercion of a compute node's job outputs, focused on the reconstruction
 * honesty field (no fabricated reading): the concrete backend is lifted from `meta.backend`,
 * with a `mock://` uri-scheme fallback so a pre-field agent that emits a
 * placeholder is still flagged. Drives the World Model honesty badge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ComputeAgentClient,
  isPlaceholderArtifact,
  type ComputeOutput,
} from "@/lib/agent/compute-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ComputeAgentClient.getOutputs — backend/meta coercion", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lifts backend from meta.backend, falls back to the mock:// uri, drops junk", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        // real backend, real artifact
        {
          id: "o-real",
          job_id: "j1",
          kind: "splat",
          uri: "https://cdn.example/real.splat",
          meta: { gaussian_count: 900000, backend: "brush" },
          created_ms: 6,
        },
        // explicit mock backend in meta
        {
          id: "o-mock",
          job_id: "j1",
          kind: "splat",
          uri: "mock://splat/ds-7",
          meta: { gaussian_count: 1000, backend: "mock" },
          created_ms: 5,
        },
        // no meta, but a mock:// uri → backend defaults to "mock"
        {
          id: "o-legacy-mock",
          job_id: "j1",
          kind: "cloud",
          uri: "mock://splat/ds-8",
          created_ms: 7,
        },
        // no meta, real uri → backend null (unknown)
        {
          id: "o-unknown",
          job_id: "j1",
          kind: "mesh",
          uri: "https://cdn.example/x.ply",
          created_ms: 8,
        },
        // malformed (missing uri) → dropped
        { id: "bad", job_id: "j1", kind: "splat" },
      ]),
    );

    const client = new ComputeAgentClient("http://node.local:8080", "k");
    const outs = (await client.getOutputs("j1")) as ComputeOutput[];

    expect(outs).toHaveLength(4);
    const byId = Object.fromEntries(outs.map((o) => [o.id, o]));

    expect(byId["o-real"].backend).toBe("brush");
    expect(byId["o-real"].meta?.gaussian_count).toBe(900000);
    expect(isPlaceholderArtifact(byId["o-real"])).toBe(false);

    expect(byId["o-mock"].backend).toBe("mock");
    expect(isPlaceholderArtifact(byId["o-mock"])).toBe(true);

    // Pre-field agent: no meta.backend, but the mock:// scheme still flags it.
    expect(byId["o-legacy-mock"].backend).toBe("mock");
    expect(byId["o-legacy-mock"].meta).toBeNull();
    expect(isPlaceholderArtifact(byId["o-legacy-mock"])).toBe(true);

    expect(byId["o-unknown"].backend).toBeNull();
    expect(byId["o-unknown"].meta).toBeNull();
    expect(isPlaceholderArtifact(byId["o-unknown"])).toBe(false);
  });

  it("ignores a non-string / empty meta.backend and reports unknown", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "o1",
          job_id: "j1",
          kind: "splat",
          uri: "https://cdn.example/a.splat",
          meta: { backend: 42 },
          created_ms: 1,
        },
        {
          id: "o2",
          job_id: "j1",
          kind: "splat",
          uri: "https://cdn.example/b.splat",
          meta: { backend: "" },
          created_ms: 2,
        },
      ]),
    );
    const client = new ComputeAgentClient("http://node.local:8080");
    const outs = (await client.getOutputs("j1")) as ComputeOutput[];
    expect(outs.map((o) => o.backend)).toEqual([null, null]);
  });

  it("returns null when the node is unreachable and [] on a non-array body", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const client = new ComputeAgentClient("http://node.local:8080");
    expect(await client.getOutputs("j1")).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ not: "an array" }));
    expect(await client.getOutputs("j1")).toEqual([]);
  });
});
