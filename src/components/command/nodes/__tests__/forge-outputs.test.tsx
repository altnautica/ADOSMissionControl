/**
 * @module nodes/forge-outputs.test
 * @description A failed output read is not "no outputs": the viewer says the
 * read failed, offers a retry, and recovers once the compute node answers. A
 * viewer is only offered for an artifact kind it can render, and is never
 * handed another kind's artifact.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/atlas/WorldModelViewport", () => ({
  WorldModelViewport: ({ viewer, artifactUrl }: { viewer: string; artifactUrl: string }) => (
    <div data-testid="viewport" data-viewer={viewer} data-url={artifactUrl} />
  ),
}));
import messages from "../../../../../locales/en.json";
import { ForgeOutputs } from "../atlas/ForgeOutputs";
import type { ComputeAgentClient, ComputeJob, ComputeOutput } from "@/lib/agent/compute-client";

const JOB: ComputeJob = {
  id: "job-1",
  kind: "reconstruct",
  datasetId: "ds-1",
  state: "completed",
  progress: 1,
  resultRef: null,
  error: null,
  sessionId: null,
  steps: null,
  params: {},
  createdMs: 1,
  updatedMs: 2,
};

function clientWith(getOutputs: () => Promise<ComputeOutput[] | null>): ComputeAgentClient {
  return { getOutputs } as unknown as ComputeAgentClient;
}

function renderOutputs(client: ComputeAgentClient) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ForgeOutputs jobs={[JOB]} client={client} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("ForgeOutputs", () => {
  it("shows a failed read with a retry, never 'no outputs'", async () => {
    const getOutputs = vi
      .fn<() => Promise<ComputeOutput[] | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([]);
    renderOutputs(clientWith(getOutputs));

    expect(await screen.findByText(messages.atlas.forgeOutputsFailed)).toBeTruthy();
    expect(screen.queryByText(messages.atlas.forgeNoOutputs)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.atlas.forgeOutputsRetry }));
    expect(await screen.findByText(messages.atlas.forgeNoOutputs)).toBeTruthy();
    expect(getOutputs).toHaveBeenCalledTimes(2);
  });

  it("says loading until the first read resolves", () => {
    const pending = Promise.withResolvers<ComputeOutput[] | null>();
    renderOutputs(clientWith(() => pending.promise));
    expect(screen.getByText(messages.atlas.forgeOutputsLoading)).toBeTruthy();
  });

  function output(kind: string, uri: string): ComputeOutput {
    return { id: uri, jobId: "job-1", kind, uri, backend: "brush" } as ComputeOutput;
  }

  it("offers only the viewers that have a matching artifact", async () => {
    renderOutputs(clientWith(async () => [output("cloud", "cloud.ply")]));
    const viewport = await screen.findByTestId("viewport");
    expect(viewport.getAttribute("data-viewer")).toBe("cloud");
    expect(viewport.getAttribute("data-url")).toBe("cloud.ply");
    expect(screen.queryByRole("button", { name: "Splat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "World" })).toBeNull();
    expect(screen.getByRole("button", { name: "LOD" })).toBeTruthy();
  });

  it("never feeds a viewer an artifact of another kind", async () => {
    renderOutputs(clientWith(async () => [output("mesh", "mesh.obj")]));
    expect(await screen.findByText(messages.atlas.forgeNoViewableArtifact)).toBeTruthy();
    expect(screen.queryByTestId("viewport")).toBeNull();
  });
});
