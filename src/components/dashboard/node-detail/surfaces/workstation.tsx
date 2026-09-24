"use client";

/**
 * @module node-detail/surfaces/workstation
 * @description Surfaces for a workstation node: Overview, one Compute tab
 * (Jobs | Viewer | Drone access), Logs, and the Agent page.
 *
 * Jobs and Viewer used to be two tabs that a freshly-paired node rendered as
 * two identical empty cards, so the profile advertised depth it had none of
 * for the whole first-run experience. They are two views of the same job list
 * — the Viewer previews the artifact of a finished one — so they are one tab
 * with a segmented control. Drone access sits beside them: which paired drones
 * hold a credential for this workstation's lanes.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import { ComputeOverview } from "@/components/command/overview/ComputeOverview";
import { JobsPanel } from "@/components/command/nodes/atlas/JobsPanel";
import { ForgeOutputs } from "@/components/command/nodes/atlas/ForgeOutputs";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { useComputeJobs } from "@/hooks/use-compute-jobs";
import { surfaceNodeDeviceId, type SurfaceSpec } from "../surface-types";
import { SegmentedPane } from "../SegmentedPane";
import { STATUS_GROUP, COMPUTE_GROUP } from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";
import { DroneAccessPanel } from "../workstation-access/DroneAccessPanel";

/** The Viewer half: the reconstruction viewer over the node's finished jobs.
 * Calm state when the compute node is unreachable (local-first). */
function WorkstationViewer({ nodeId }: { nodeId?: string }) {
  const t = useTranslations("atlas");
  const { jobs, client } = useComputeJobs(nodeId);
  if (!client) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div className="text-center">
          <Boxes className="mx-auto mb-2 h-5 w-5 text-text-tertiary" />
          <p className="max-w-sm text-[11px] text-text-tertiary">
            {t("forgeLocalOnly")}
          </p>
        </div>
      </div>
    );
  }
  return <ForgeOutputs jobs={jobs} client={client} />;
}

/** The one Compute surface: the job queue, the artifact viewer over it, and
 * which drones may use this node's lanes. */
function ComputePane({ nodeId }: { nodeId: string }) {
  const t = useTranslations("atlas");
  return (
    <SegmentedPane
      ariaLabel={t("computePaneLabel")}
      segments={[
        {
          id: "jobs",
          label: t("forgeJobs"),
          render: () => <JobsPanel nodeId={nodeId} />,
        },
        {
          id: "viewer",
          label: t("viewerGroupLabel"),
          render: () => <WorkstationViewer nodeId={nodeId} />,
        },
        {
          id: "access",
          label: t("droneAccess.segment"),
          render: () => <DroneAccessPanel nodeId={nodeId} />,
        },
      ]}
    />
  );
}

export const WORKSTATION_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    render: (ctx) => <ComputeOverview nodeId={ctx.droneId} />,
  },
  {
    id: "compute",
    labelKey: "nodeDetail.groups.compute",
    group: COMPUTE_GROUP,
    render: (ctx) => <ComputePane nodeId={ctx.droneId} />,
  },
  {
    id: "logs",
    labelKey: "dronePanel.logs",
    render: (ctx) => (
      <LogsTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} showFlights={false} />
    ),
  },
  AGENT_SURFACE,
];
