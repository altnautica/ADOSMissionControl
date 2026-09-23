"use client";

/**
 * @module ForgeOutputs
 * @description Outputs sub-view of the Atlas Forge workbench: pick a finished
 * job and preview its reconstructed artifact in the selectable World Model
 * viewer (Rerun / Splat / Cloud). Fetches the job's outputs on demand from the
 * compute node; renders a calm empty state when a job has no artifact yet.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import type {
  ComputeAgentClient,
  ComputeJob,
  ComputeOutput,
} from "@/lib/agent/compute-client";
import { Select, type SelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  ATLAS_VIEWERS,
  pickArtifactForViewer,
  viewerForKind,
  type AtlasViewer,
} from "@/components/atlas/viewer-types";
import { WorldModelViewport } from "@/components/atlas/WorldModelViewport";
import { ViewerSwitcher } from "@/components/atlas/ViewerSwitcher";

export function ForgeOutputs({
  jobs,
  client,
}: {
  jobs: ComputeJob[];
  client: ComputeAgentClient | null;
}) {
  const t = useTranslations("atlas");
  // Only finished jobs produce artifacts to preview, newest first (the engine
  // returns them oldest-first, so an unsorted default would show a stale job).
  const finished = useMemo(
    () =>
      jobs
        .filter((j) => j.state === "completed")
        .sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0)),
    [jobs],
  );
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  // Outputs are keyed to the job they belong to so a switch never shows the
  // previous job's artifact while the new fetch is in flight. `outputs: null`
  // is a failed read (unreachable / non-2xx), distinct from a reachable job
  // with no artifacts yet (`[]`).
  const [outputState, setOutputState] = useState<{
    jobId: string;
    outputs: ComputeOutput[] | null;
  }>({ jobId: "", outputs: [] });
  const [retryNonce, setRetryNonce] = useState(0);
  // The client + job whose non-empty outputs are loaded; once set, the job poll
  // stops refetching them.
  const loadedRef = useRef<{ client: ComputeAgentClient; jobId: string } | null>(null);
  // A manual viewer choice, keyed to the job it was made for. When the job
  // changes the override drops and the viewer follows the artifact's kind.
  const [override, setOverride] = useState<{
    jobId: string;
    viewer: AtlasViewer;
  } | null>(null);

  // Default the selection to the latest finished job when none is chosen.
  const effectiveJobId =
    finished.find((j) => j.id === selectedJobId)?.id ?? finished[0]?.id ?? "";

  // Fetch on job switch, on a manual retry, and on every job-poll tick while
  // the outputs are still empty or failed (a transient failure or an artifact
  // that lands after the job completes both recover without a job switch).
  useEffect(() => {
    if (!client || !effectiveJobId) return;
    const loaded = loadedRef.current;
    if (loaded && loaded.client === client && loaded.jobId === effectiveJobId) return;
    let cancelled = false;
    void client.getOutputs(effectiveJobId).then((res) => {
      if (cancelled) return;
      if (res && res.length > 0) loadedRef.current = { client, jobId: effectiveJobId };
      setOutputState({ jobId: effectiveJobId, outputs: res });
    });
    return () => {
      cancelled = true;
    };
  }, [client, effectiveJobId, jobs, retryNonce]);

  const fetched = outputState.jobId === effectiveJobId;
  const failed = fetched && outputState.outputs === null;
  const outputs = fetched ? (outputState.outputs ?? []) : [];
  const primary = outputs[0] ?? null;
  // Each viewer consumes the artifact matching ITS kind (World→`.rrd`,
  // Splat→splat `.ply`, Cloud/LOD→point-cloud `.ply`). A job can emit both a
  // splat and a point-cloud `.ply`, so only a viewer with a matching output is
  // offered, and a viewer is never handed another kind's artifact (a plain
  // point cloud in the splat renderer draws nothing).
  const viewable = ATLAS_VIEWERS.filter(
    (v) => pickArtifactForViewer(outputs, v.id) !== undefined,
  );
  const kindViewer = viewerForKind(primary?.kind ?? "");
  const defaultViewer: AtlasViewer = viewable.some((v) => v.id === kindViewer)
    ? kindViewer
    : (viewable[0]?.id ?? kindViewer);
  // A manual choice (for this job) wins when that viewer has an artifact.
  const viewer =
    override &&
    override.jobId === effectiveJobId &&
    viewable.some((v) => v.id === override.viewer)
      ? override.viewer
      : defaultViewer;
  const artifact = pickArtifactForViewer(outputs, viewer);

  if (finished.length === 0) {
    return (
      <div className="text-[11px] text-text-tertiary text-center py-8">
        {t("forgeNoOutputs")}
      </div>
    );
  }

  const jobOptions: SelectOption[] = finished.map((j) => ({
    value: j.id,
    label: `${j.kind} · ${j.id}`,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-border-default">
        <Select
          options={jobOptions}
          value={effectiveJobId}
          onChange={setSelectedJobId}
          placeholder={t("forgeSelectJob")}
          className="w-56"
        />
        {viewable.length > 0 && (
          <ViewerSwitcher
            viewer={viewer}
            viewers={viewable}
            onSelect={(v) => setOverride({ jobId: effectiveJobId, viewer: v })}
            ariaLabel={t("forgeOutputs")}
          />
        )}
      </div>

      <div className="flex-1 relative min-h-[320px]">
        {artifact ? (
          <WorldModelViewport
            viewer={viewer}
            artifactUrl={artifact.uri}
            backend={artifact.backend}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <Boxes className="w-5 h-5 text-text-tertiary mx-auto mb-2" />
              <p className="text-[11px] text-text-tertiary max-w-xs">
                {!fetched
                  ? t("forgeOutputsLoading")
                  : failed
                    ? t("forgeOutputsFailed")
                    : outputs.length > 0
                      ? t("forgeNoViewableArtifact")
                      : t("forgeNoOutputs")}
              </p>
              {failed && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setRetryNonce((n) => n + 1)}
                >
                  {t("forgeOutputsRetry")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
