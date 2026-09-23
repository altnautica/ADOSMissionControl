"use client";

/**
 * @module DroneOverview
 * @description The unified per-node Overview for the `drone` profile.
 *
 * For a smart drone (an ADOS agent paired to a flight controller) the
 * agent/companion band LEADS — the ADOS agent is the product — with the live
 * video as its prime tile, followed by the flight-controller console band. A
 * bare flight controller (no paired agent) shows ONLY the FC console band plus
 * an inline "add a companion computer" CTA.
 *
 * The former standalone FC-link card is merged into the consolidated Flight
 * Data card, and the duplicate GPS / Radio / Attitude cards are gone (Flight
 * Data carries all three), so the grid packs without gaps.
 *
 * Rendered directly by the drone `overview` surface, which passes the surface
 * `ctx`.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sliders } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useUiStore } from "@/stores/ui-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { ServiceTable } from "../shared/ServiceTable";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { Sparkline } from "../shared/Sparkline";
import { LogViewer } from "../shared/LogViewer";
import { StaleOverlay } from "@/components/shared/link-up/StaleOverlay";
import { StaleBanner } from "../shared/StaleBanner";
import { VideoRestartBanner } from "../shared/VideoRestartBanner";
import { VideoFeedCard } from "../shared/VideoFeedCard";
import { ComputeMetricsCard } from "../shared/ComputeMetricsCard";
import { StatTile } from "../shared/StatTile";
import { Button } from "@/components/ui/button";
import { openPairNode } from "@/components/shared/link-up/link-up-actions";
import { NodeReachBlock } from "../shared/NodeReachBlock";
import { NodeBrandHeader } from "./NodeBrandHeader";
import { OverviewTile, OverviewSection, OverviewGrid } from "./OverviewGrid";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { surfaceNodeDeviceId } from "@/components/dashboard/node-detail/surface-types";
import { effectiveNodeProfile } from "@/components/dashboard/node-detail/node-brand";
import { useReachedViaName } from "@/lib/nodes/reach-provenance";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { useControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { requestGrant } from "@/stores/mqtt-control-grant-store";

/**
 * The drone Status surface — the node HOME.
 *
 * Identity, reach, health, the companion band and the per-node actions. It
 * deliberately carries no live telemetry: attitude, GPS, battery, RC and the
 * FC message stream all live on Flight. The two surfaces used to answer the
 * same question from different sources with different freshness gating, so a
 * dead link produced "link silent / Roll --.-°" on one tile and a confident
 * "68% · 15.9V" on the next, and the frozen one looked the healthier.
 */
export function DroneOverview({ ctx }: { ctx: SurfaceContext }) {
  const agentReachable = ctx.agentDeviceId !== null || ctx.relayReach !== null;
  const companionKnown = agentReachable || ctx.drone.agentIdentityKnown === true;
  const profile = effectiveNodeProfile(ctx);
  // A WFB-linked drone reached only through a ground node names its reach hop
  // on the hero. Undefined for a directly-reached drone (no sub-badge).
  const reachedViaName = useReachedViaName(ctx.drone.reachedVia);

  return (
    <div className="space-y-4 p-4">
      <NodeBrandHeader
        profile={profile}
        title={ctx.displayName}
        reachedViaName={reachedViaName}
        fcConnected={ctx.isConnected}
      />

      {/* How this browser last reached the node, and the address it used.
          Renders nothing until a reach has actually been recorded. */}
      <NodeReachBlock deviceId={surfaceNodeDeviceId(ctx) ?? ""} />

      {/* The ADOS agent (companion) band leads for a smart drone — the agent is
          the product, and its live video is the prime tile. A bare FC (no
          companion) skips this and shows only the FC console band + the
          add-a-computer CTA below. */}
      {agentReachable && (
        <CompanionBand droneId={ctx.droneId} />
      )}

      {/* A companion this node HAS but the GCS cannot reach. Rendering
          nothing here lost half the surface with no explanation, and the
          add-a-computer CTA was suppressed because the companion IS known. */}
      {!agentReachable && companionKnown && (
        <OverviewGrid>
          <OverviewTile span="half">
            <CompanionOfflineNotice
              droneId={ctx.droneId}
              reachedViaName={reachedViaName ?? undefined}
            />
          </OverviewTile>
        </OverviewGrid>
      )}

      {/* The flight-controller console — always present. */}
      <FcBand ctx={ctx} />

      {!companionKnown && (
        <OverviewGrid>
          <OverviewTile span="half">
            <AddCompanionCta />
          </OverviewTile>
        </OverviewGrid>
      )}
    </div>
  );
}

/**
 * The flight-controller band on the node home: the cached-parameter snapshot
 * and the one operator-actionable authority affordance.
 *
 * The live tiles that used to sit here (Flight Data, Battery, Sensors, RC,
 * FC status messages) are on Flight. Battery and GPS were already rendered
 * there by the telemetry readout and the info cards, from a different source
 * with different gating; sensors, RC and the message stream moved across
 * wholesale.
 */
function FcBand({ ctx }: { ctx: SurfaceContext }) {
  return (
    <OverviewSection>
      <OverviewTile span="half">
        <ParamsSnapshotTile isConnected={ctx.isConnected} />
      </OverviewTile>
    </OverviewSection>
  );
}

/**
 * A companion the node HAS but this browser cannot reach right now. Names it,
 * says so, and offers the two things that recover it.
 */
function CompanionOfflineNotice({
  droneId,
  reachedViaName,
}: {
  droneId: string;
  reachedViaName?: string;
}) {
  const t = useTranslations("dronePanel.companionOffline");
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);
  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-status-warning">
        {t("title")}
      </h3>
      <p className="text-xs text-text-secondary">
        {reachedViaName ? t("viaHop", { hop: reachedViaName }) : t("body")}
      </p>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={openPairNode}>
          {t("repair")}
        </Button>
        <button
          type="button"
          onClick={() => setPendingDetailTab("agent")}
          className="text-xs font-medium text-accent-primary hover:underline cursor-pointer"
        >
          {t("openAgent")}
        </button>
      </div>
      <span className="sr-only">{droneId}</span>
    </div>
  );
}

/** The agent-dashboard cards, shown only when a companion computer is paired.
 * The live video is the prime tile (top-left, half × 2 rows).
 *
 * The agent-side FC source picker used to live here. It is the single control
 * that fixes "the companion can't find my flight controller", and it sat on a
 * different tab from the placeholder that reports the problem — inside a band
 * that only renders when the companion is reachable. It is on Setup now. */
function CompanionBand({ droneId }: { droneId: string }) {
  const connected = useAgentConnectionStore((s) => s.connected);
  const status = useAgentSystemStore((s) => s.status);
  const services = useAgentSystemStore((s) => s.services);
  const resources = useAgentSystemStore((s) => s.resources);
  const logs = useAgentSystemStore((s) => s.logs);
  const processCpu = useAgentSystemStore((s) => s.processCpuPercent);
  const processMemMb = useAgentSystemStore((s) => s.processMemoryMb);
  const fetchServices = useAgentSystemStore((s) => s.fetchServices);
  const fetchResources = useAgentSystemStore((s) => s.fetchResources);
  const fetchLogs = useAgentSystemStore((s) => s.fetchLogs);
  const restartService = useAgentSystemStore((s) => s.restartService);
  const restartAll = useAgentSystemStore((s) => s.restartAll);

  useEffect(() => {
    if (connected) {
      fetchServices();
      fetchResources();
      fetchLogs();
    }
  }, [connected, fetchServices, fetchResources, fetchLogs]);

  return (
    <div className="relative space-y-4">
      <StaleBanner />
      <VideoRestartBanner />
      <StaleOverlay />
      <OverviewSection>
        {/* Live video — the prime tile, top-left. */}
        <OverviewTile span="half" rowSpan={2}>
          <VideoFeedCard />
        </OverviewTile>
        {status && (
          <OverviewTile span="half">
            <AgentStatusCard status={status} profile="drone" />
          </OverviewTile>
        )}
        {/* First-party features (World Model, …) now live in the Settings tab. */}
        <OverviewTile span="half">
          <ComputeMetricsCard />
        </OverviewTile>
        {resources && (
          <OverviewTile span="half">
            <SystemResourceGauges resources={resources} />
          </OverviewTile>
        )}
        <OverviewTile span="quarter">
          <Sparkline series="cpuHistory" tokenColor="--color-accent-primary" />
        </OverviewTile>
        <OverviewTile span="quarter">
          <Sparkline series="memoryHistory" tokenColor="--color-accent-secondary" />
        </OverviewTile>
        <OverviewTile span="half">
          <ServiceTable
            services={services}
            onRestart={restartService}
            onRestartAll={restartAll}
            processCpu={processCpu}
            processMemoryMb={processMemMb}
          />
        </OverviewTile>
        <OverviewTile span="full">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
      </OverviewSection>
    </div>
  );
}

/** Inline recognition affordance shown on an FC-only node — the FC console is
 * complete without a companion, this just explains the upgrade path. */
function AddCompanionCta() {
  const t = useTranslations("nodeConsole");
  const openDialog = usePairDialogStore((s) => s.openDialog);
  return (
    <div className="flex h-full flex-col justify-between rounded-lg border border-dashed border-border-default bg-bg-secondary p-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {t("companionCta.title")}
        </h3>
        <p className="mt-1 text-xs text-text-secondary">
          {t("companionCta.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => openDialog("add")}
        className="mt-3 self-start rounded-md border border-border-default bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:border-accent-primary hover:text-accent-primary"
      >
        {t("companionCta.action")}
      </button>
    </div>
  );
}

/**
 * Params snapshot — cached-param count, plus the one operator-actionable
 * authority affordance on this surface.
 */
function ParamsSnapshotTile({ isConnected }: { isConnected: boolean }) {
  const t = useTranslations("nodeConsole");
  // A parameter WRITE is an FC frame, so this tile's jump-off leads somewhere
  // that cannot land while the browser holds no publish grant. Grading it on
  // `isConnected` alone is the same mistake the Flight Data link dot was fixed
  // for: the transport is open and the writes go nowhere. The cached count
  // itself is a read and stays exactly as accurate as before.
  const authority = useMqttControlAuthority();
  const notice = useControlAuthorityNotice(authority);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);
  const [count, setCount] = useState<number | null>(null);

  // The three states a mint fixes: none held, one lapsed, one lapsing with a
  // failed renewal. `provisioning` is deliberately absent — a mint is already in
  // flight and a second click would only queue a redundant one.
  const canRequestControl =
    authority.reason === "no-grant" ||
    authority.reason === "grant-expired" ||
    authority.reason === "grant-expiring";

  useEffect(() => {
    const read = () => {
      const protocol = getProtocol();
      if (!protocol) {
        setCount(null);
        return;
      }
      setCount(protocol.getCachedParameterNames().length);
    };
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, [getProtocol]);

  const value =
    !isConnected || count === null ? "—" : count === 0 ? "0" : String(count);

  return (
    <button
      type="button"
      // Sending the operator to a tab whose every write is refused is worse than
      // useless, so while control is the missing piece this button obtains it
      // instead of navigating.
      onClick={() => {
        if (canRequestControl) {
          void requestGrant();
          return;
        }
        setPendingDetailTab("parameters");
      }}
      className="h-full w-full text-left transition-transform hover:-translate-y-px"
    >
      <StatTile
        icon={<Sliders className="h-3 w-3" />}
        label={t("params.label")}
        value={value}
        level={!isConnected ? "offline" : notice.show ? notice.level : "good"}
        hint={
          canRequestControl
            ? t("authority.requestControl")
            : notice.show
              ? notice.detail
              : t("params.openHint")
        }
      />
    </button>
  );
}
