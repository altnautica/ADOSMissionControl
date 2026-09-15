"use client";

/**
 * @module MeshTab
 * @description Renders the "Mesh & RX" surface for a ground-station node: the
 * role picker, then batman-adv mesh health / neighbours / gateways, then the
 * distributed-receive data plane.
 *
 * The two halves used to be separate tabs, each polling `/role` on its own
 * cadence and each rendering its own role picker, and both were gated on the
 * node ALREADY being a relay or receiver. A freshly-imaged box is `unset` and
 * a solo box is `direct`, so the only role picker in node detail was hidden
 * from exactly the nodes that needed it. This tab is therefore always present:
 * control plane and data plane for one mesh, with one role poll and one
 * picker, reachable at any role.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { MeshHealthCard } from "@/components/hardware/MeshHealthCard";
import { MeshNeighborsTable } from "@/components/hardware/MeshNeighborsTable";
import { MeshGatewaysTable } from "@/components/hardware/MeshGatewaysTable";
import { RoleChangeCard } from "@/components/hardware/RoleChangeCard";
import { DistributedRxPanel } from "@/components/hardware/DistributedRxPanel";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { Button } from "@/components/ui/button";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { useGroundStationPoll } from "./use-gs-poll";

const POLL_INTERVAL_MS = 3000;

export function MeshTab() {
  const t = useTranslations("hardware.mesh");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const loadRole = useGroundStationStore((s) => s.loadRole);
  const loadMesh = useGroundStationStore((s) => s.loadMesh);
  const loadDistributedRx = useGroundStationStore((s) => s.loadDistributedRx);
  // Read the role INFO, not a `?? "direct"` collapse. A failed `/role` fetch
  // leaves `info` null, and reporting that as "this node is in direct mode" is
  // an affirmative, wrong statement that also buried the error naming the fix.
  const roleInfo = useGroundStationStore((s) => s.role.info);
  const roleError = useGroundStationStore((s) => s.role.error);
  const meshError = useGroundStationStore((s) => s.mesh.error);

  useGroundStationPoll(agentUrl, apiKey, POLL_INTERVAL_MS, async (api) => {
    await loadRole(api);
    await loadMesh(api);
    await loadDistributedRx(api);
  });

  const retry = () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (api) void loadMesh(api);
  };

  const role = roleInfo?.current ?? null;
  const meshCarriesTraffic = role === "relay" || role === "receiver";
  const onCloudOnly = !agentUrl;

  return (
    <div className="flex flex-col">
      <PageIntro
        title="Mesh & RX"
        description="Self-healing wireless mesh between ground nodes, and the distributed receive surface it carries. Set this node's role, then watch neighbours, gateways and merged streams."
        trailing={
          <HintChip>
            Direct = solo. Relay forwards. Receiver combines.
          </HintChip>
        }
      />
      {onCloudOnly ? <CloudModeLimitedNotice feature="mesh" /> : null}
      <div className="flex flex-col gap-4">
        {roleError ? (
          <div
            className="rounded-sm border border-status-error bg-status-error/10 px-3 py-2 text-sm text-status-error"
            role="alert"
            aria-live="polite"
          >
            {roleError}
          </div>
        ) : null}

        {/* The role picker leads: it is the control that makes the rest of
            this surface meaningful, and on a direct / unset node it is the
            only thing to do here. */}
        <RoleChangeCard variant={meshCarriesTraffic ? "switch" : "empty"} />

        {meshCarriesTraffic ? (
          <>
            <MeshHealthCard />
            <MeshNeighborsTable />
            <MeshGatewaysTable />
            {meshError ? (
              <div
                className="flex items-center justify-between gap-3 rounded-sm border border-status-error bg-status-error/10 px-3 py-2 text-sm text-status-error"
                role="alert"
                aria-live="polite"
              >
                <span>{meshError}</span>
                <Button size="sm" variant="ghost" onClick={retry}>
                  Retry
                </Button>
              </div>
            ) : null}
            <DistributedRxPanel />
          </>
        ) : (
          <div className="text-text-secondary">
            {role === "unset" || role === null
              ? t("emptyUnset")
              : t("emptyDirect")}
          </div>
        )}
      </div>
    </div>
  );
}
