/**
 * "Run again" on a compute job resubmits the job exactly as the engine stored
 * it. A reconstruct job the ingest created carries the drone and session it
 * came from; the worker publishes nothing without `device_id`, so a re-run that
 * drops it runs to completion and is never seen.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { ForgeJobs } from "@/components/command/nodes/atlas/ForgeJobs";
import { ComputeAgentClient } from "@/lib/agent/compute-client";

afterEach(() => vi.unstubAllGlobals());

describe("Forge re-run", () => {
  it("resubmits the failed job's params verbatim", async () => {
    // The engine's job record for an ingest-created reconstruct
    // (ados-compute ingest.rs + the jobs listing).
    const failed = {
      id: "job-7",
      kind: "reconstruct",
      dataset_id: "ds-7",
      state: "failed",
      progress: 0.2,
      result_ref: null,
      error: "trainer exited",
      session_id: "s-7",
      params: { backend: "auto", session_id: "s-7", steps: 15000, generation: 2, device_id: "drone-7" },
      created_ms: 1,
      updated_ms: 2,
    };
    const posted: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ job_id: "job-8", state: "queued" }), { status: 200 });
      }
      return new Response(JSON.stringify([failed]), { status: 200 });
    }));

    const client = new ComputeAgentClient("http://192.168.1.50:8080", "k");
    const jobs = (await client.listJobs()) ?? [];
    renderWithIntl(<ForgeJobs jobs={jobs} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      kind: "reconstruct",
      dataset_id: "ds-7",
      params: failed.params,
    });
  });
});
