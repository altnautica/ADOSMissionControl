"use client";

/**
 * @module JobsPanel
 * @description The workstation's Jobs tab: one table over the compute node's
 * reconstruction / offload jobs with a portal Select group-by (Flat / By dataset
 * / By status). Absorbs the former Datasets sub-view — "By dataset" is the same
 * per-dataset grouping. Reuses ForgeJobs for row rendering (state badges,
 * progress, cancel). Local-first job source; a calm state when Atlas
 * is off or the compute node is unreachable, never an error.
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type {
  ComputeAgentClient,
  ComputeJob,
} from "@/lib/agent/compute-client";
import { useComputeJobs } from "@/hooks/use-compute-jobs";
import { ForgeJobs } from "./ForgeJobs";

/** Brush's shipped default training-step count for a new reconstruction. */
const DEFAULT_RECONSTRUCT_STEPS = 30000;

type GroupBy = "flat" | "dataset" | "status";

/** Group-by option -> its `nodeConsole.jobs.*` key. */
const GROUP_LABEL_KEYS: Record<GroupBy, string> = {
  flat: "jobs.flat",
  dataset: "jobs.byDataset",
  status: "jobs.byStatus",
};

/** Preferred ordering for the "By status" bands; unknown states trail after. */
const STATUS_ORDER = ["queued", "running", "completed", "failed", "cancelled"];
/** atlas i18n keys for the known job states (unknown → raw state). */
const STATUS_KEYS: Record<string, string> = {
  queued: "jobQueued",
  running: "jobRunning",
  completed: "jobCompleted",
  failed: "jobFailed",
  cancelled: "jobCancelled",
};

/** Group a job list by a derived key, preserving first-seen order. */
function bucket(
  list: ComputeJob[],
  keyOf: (j: ComputeJob) => string,
): Map<string, ComputeJob[]> {
  const map = new Map<string, ComputeJob[]>();
  for (const j of list) {
    const k = keyOf(j);
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(j);
  }
  return map;
}

function Calm({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center p-6">
      <div className="text-center">
        <Boxes className="mx-auto mb-2 h-5 w-5 text-text-tertiary" />
        <p className="max-w-sm text-[11px] text-text-tertiary">{message}</p>
      </div>
    </div>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-text-tertiary">
      <span className="truncate">{label}</span>
      <span className="font-mono tabular-nums">· {count}</span>
    </div>
  );
}

export function JobsPanel({ nodeId }: { nodeId?: string }) {
  const t = useTranslations("atlas");
  const tNode = useTranslations("nodeConsole");
  const { jobs, loading, unreachable, client } = useComputeJobs(nodeId);
  const [groupBy, setGroupBy] = useState<GroupBy>("flat");

  // Newest-first flat order (the "Flat" mode and the input to grouping).
  const sorted = useMemo(
    () => [...jobs].sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0)),
    [jobs],
  );

  // The datasets this node has actually produced work for. Derived from the
  // job list rather than a second fetch: every dataset the engine knows about
  // reached it through a job.
  const datasetIds = useMemo(() => {
    const seen = new Set<string>();
    for (const job of sorted) if (job.datasetId) seen.add(job.datasetId);
    return [...seen];
  }, [sorted]);

  const groups = useMemo<
    { key: string; label: string; jobs: ComputeJob[] }[]
  >(() => {
    if (groupBy === "dataset") {
      const map = bucket(sorted, (j) => j.datasetId ?? "__none__");
      return [...map.entries()].map(([key, list]) => ({
        key,
        label: key === "__none__" ? tNode("jobs.noDataset") : key,
        jobs: list,
      }));
    }
    if (groupBy === "status") {
      const map = bucket(sorted, (j) => j.state);
      const ordered = [
        ...STATUS_ORDER.filter((s) => map.has(s)),
        ...[...map.keys()].filter((s) => !STATUS_ORDER.includes(s)),
      ];
      return ordered.map((state) => ({
        key: state,
        label: STATUS_KEYS[state] ? t(STATUS_KEYS[state]) : state,
        jobs: map.get(state) ?? [],
      }));
    }
    return [];
  }, [groupBy, sorted, t, tNode]);

  // Atlas is a default on a workstation; the calm state covers an unreachable
  // compute API over the LAN.
  if (!client) return <Calm message={t("forgeLocalOnly")} />;

  const groupOptions: SelectOption[] = (
    Object.keys(GROUP_LABEL_KEYS) as GroupBy[]
  ).map((g) => ({ value: g, label: tNode(GROUP_LABEL_KEYS[g]) }));

  const table = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
        </div>
      );
    }
    if (unreachable) {
      return <Calm message={t("forgeAwaiting")} />;
    }
    if (groupBy === "flat") {
      return <ForgeJobs jobs={sorted} client={client} />;
    }
    return (
      <div className="p-1">
        {groups.map((g) => (
          <div key={g.key}>
            <GroupHeader label={g.label} count={g.jobs.length} />
            <ForgeJobs jobs={g.jobs} client={client} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-default p-2">
        <span className="text-[11px] text-text-tertiary">
          {tNode("jobs.groupBy")}
        </span>
        <Select
          options={groupOptions}
          value={groupBy}
          onChange={(v) => setGroupBy(v as GroupBy)}
          className="w-40"
        />
        {/* The dataset list is derived from the job list, so it is unknown
            until the first poll lands and while the node is unreachable. */}
        {!loading && !unreachable && (
          <div className="ml-auto">
            <SubmitJobButton client={client} datasetIds={datasetIds} jobs={jobs} />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">{table()}</div>
    </div>
  );
}

/**
 * Queue a reconstruction from the workstation itself.
 *
 * Submission previously existed only on the drone's Live World tab and the
 * perception tier card, so a compute node's own Jobs surface could cancel work
 * but never start any — including re-running the dataset of a job that failed
 * before this list existed.
 */
/** The keys that attribute a reconstruction to its drone and session. The
 * worker publishes a world model only with a device_id. */
const ATTRIBUTION_KEYS = ["device_id", "session_id", "generation", "backend"] as const;

function SubmitJobButton({
  client,
  datasetIds,
  jobs,
}: {
  client: ComputeAgentClient;
  datasetIds: string[];
  /** Jobs already on this node; a reconstruct job on the same dataset carries
   * the drone and session the dataset came from. */
  jobs: readonly ComputeJob[];
}) {
  const t = useTranslations("atlas");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [steps, setSteps] = useState(String(DEFAULT_RECONSTRUCT_STEPS));
  const [busy, setBusy] = useState(false);

  const effectiveDataset = datasetId || (datasetIds[0] ?? "");

  const submit = async () => {
    if (!effectiveDataset) return;
    setBusy(true);
    const parsed = Number.parseInt(steps, 10);
    const sibling = jobs.find(
      (j) => j.datasetId === effectiveDataset && j.kind === "reconstruct",
    );
    const attribution = Object.fromEntries(
      ATTRIBUTION_KEYS.filter((k) => sibling?.params[k] !== undefined).map((k) => [
        k,
        sibling?.params[k],
      ]),
    );
    const result = await client.submitJob({
      kind: "reconstruct",
      datasetId: effectiveDataset,
      params: {
        ...attribution,
        steps: Number.isFinite(parsed) ? parsed : DEFAULT_RECONSTRUCT_STEPS,
      },
    });
    setBusy(false);
    if (result === null) {
      toast(t("forgeSubmitFailed"), "error");
      return;
    }
    toast(t("forgeSubmitQueued"), "success");
    setOpen(false);
  };

  if (datasetIds.length === 0) {
    // Nothing to reconstruct FROM. Offering a submit control that can only
    // fail would be worse than saying why it is absent.
    return (
      <span className="text-[11px] text-text-tertiary">
        {t("forgeNoDatasets")}
      </span>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("forgeSubmit")}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        options={datasetIds.map((id) => ({ value: id, label: id }))}
        value={effectiveDataset}
        onChange={setDatasetId}
        className="w-44"
      />
      <input
        type="number"
        min={1000}
        step={1000}
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
        aria-label={t("forgeSteps")}
        className="w-24 rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
      />
      <Button size="sm" onClick={submit} disabled={busy}>
        {t("forgeSubmit")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("forgeSubmitCancel")}
      </Button>
    </div>
  );
}
