"use client";

/**
 * @module node-detail/NodeDetailPanel
 * @description The unified per-node detail panel for the Dashboard, central
 * command for every agent profile (drone / ground-station / compute / future).
 * The header chrome + tab strip are profile-agnostic; the visible surfaces are
 * resolved from the node's profile + role + capabilities via the surface
 * registry (./surfaces). Built-in surfaces and plugin-contributed tabs share
 * one render path.
 *
 * The shell reads only slow-changing inputs: its own fleet row (the projector
 * keeps row identity until that row changes), the managed-session map and the
 * node's capability slice. Inputs that change at telemetry or clock rate live
 * in the header chips, so a frame for another drone or a clock tick does not
 * rebuild the active surface.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
  capabilityPresence,
} from "@/stores/agent-capabilities-store";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { useAtlasReadinessStore } from "@/stores/atlas-readiness-store";
import { useClockStore } from "@/stores/clock-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { DroneStatusBadge } from "@/components/shared/drone-status-badge";
import {
  DroneDetailTabBody,
  isPluginTabId,
  pluginTabIds,
} from "@/components/plugins/DroneDetailTabHost";
import { PluginHostProvider } from "@/components/plugins/PluginHostProvider";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { useDronePluginContributions } from "@/hooks/use-drone-plugin-contributions";
import { useAtlasControl } from "@/hooks/use-atlas-control";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveRelayReach } from "@/lib/nodes/relay-reach";
import { cn } from "@/lib/utils";
import { SurfaceErrorBoundary, SurfaceBody } from "./SurfaceErrorBoundary";
import { resolveSurfaces } from "./surfaces";
import type { SurfaceContext } from "./surface-types";
import {
  AgentSubpageHandoff,
  ImmersiveGuard,
  TabMemory,
  resolveNodeTab,
  useNodeTab,
} from "./node-tab-state";
import { NodeTabStrip } from "./NodeTabStrip";
import { NodeHeaderActions } from "./NodeHeaderActions";
import { NodeAuthorityChip, NodeConnectChip } from "./NodeHeaderChips";

interface NodeDetailPanelProps {
  droneId: string;
  onClose: () => void;
}

export function NodeDetailPanel({ droneId, onClose }: NodeDetailPanelProps) {
  const t = useTranslations("dronePanel");
  // The panel is deliberately not remounted per node (no `key` at the call
  // site: the Agent page's sub-page memory depends on the instance
  // surviving), so the tab is reseeded per node.
  const [activeTab, setActiveTab] = useNodeTab(droneId);

  // Only this node's row: the projector keeps a row's identity until the row
  // itself changes, so another drone's telemetry does not re-render the panel.
  const drone = useFleetStore((s) => s.drones.find((d) => d.id === droneId));
  // This drone is backed by a companion-computer agent when the fleet row
  // carries the agent's device id (cloud-paired or LAN-paired projector).
  const agentDeviceId = drone?.cloudDeviceId ?? null;

  // When this drone is reached ONLY through a ground node's WFB relay, the
  // ground node's host + API key + the linked drone's device id form a
  // relay-proxy reach.
  const relayReach = resolveRelayReach({
    agentDeviceId,
    reachedVia: drone?.reachedVia,
    droneDeviceId: droneId,
  });

  // The reachable identity of THIS node's agent: direct when the GCS holds it,
  // else the relayed drone's own peer id. The connect chip keys on it.
  const focusDeviceId = agentDeviceId ?? relayReach?.peerDeviceId ?? null;

  // Capability gates resolve from THIS node's remembered slice, never from the
  // process-wide focused one, so a node switch paints B's own last known
  // gates on the first frame instead of A's.
  const caps = useAgentCapabilitiesStore((s) => selectDeviceCapabilities(s, focusDeviceId));
  // Tri-state: a node this browser has never heard describe itself is
  // `unknown`, which is not `absent`.
  const radioPresent = capabilityPresence(caps, (c) => c.radio !== null);
  const crsfPresent = capabilityPresence(caps, (c) => c.crsf !== null);
  const visionPresent = capabilityPresence(caps, (c) => c.visionAvailable === true);

  // The node's bare agent device id. `droneId` is the selection id
  // (`node:<deviceId>`); every per-node store and install table below is keyed
  // by the bare id the node reports on the wire.
  const bareDeviceId = deviceIdFromNodeId(droneId) ?? droneId;
  // An expired readiness snapshot (the node stopped answering) is not a
  // capture; `useAtlasControl` below keeps the shared clock ticking.
  const clockNow = useClockStore((s) => s.now);
  const atlasCapturing = useAtlasReadinessStore((s) => s.isCapturing(bareDeviceId, clockNow));
  // Per-node first-party feature opt-ins (World Model / Live World surfaces).
  const nodeFeatureIds = useNodeFeaturesStore((s) => s.enabled[bareDeviceId]);
  // Populate the per-drone Atlas readiness from the panel level so the Live
  // World tab can auto-reveal while capturing regardless of which tab is open.
  // The hook self-gates its poll on the per-node World Model feature.
  useAtlasControl((drone?.profile ?? "drone") === "drone" ? droneId : null);

  // Companion tabs render when this node is backed by an agent the GCS can
  // reach, directly or through its ground station's relay-proxy.
  const showAgentTabs = agentDeviceId !== null || relayReach !== null;

  const metadata = useDroneMetadataStore((s) => s.profiles[droneId]);
  const managedDrones = useDroneManager((s) => s.drones);
  const isConnected = managedDrones.has(droneId);
  // The agent advertises an FC before the GCS has finished dialing the live
  // MAVLink session (or an identified MSP FC with its transport open, which
  // never sets fc_connected). During that window the Configure tab reads
  // "linking", not the hard "no FC / connect one" placeholder.
  const agentStatus = useAgentSystemStore((s) => s.status);
  const agentFcReachable = isFcReachable({
    fcConnected: agentStatus?.fc_connected,
    fcVariant: agentStatus?.fc_variant,
    transportOpen: agentStatus?.transport_open,
  });
  const fcLinking = !isConnected && agentDeviceId !== null && agentFcReachable;

  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const displayName = metadata?.displayName ?? drone?.name ?? droneId;

  // Live per-node plugin contributions feed the host provider so the
  // node.detail.tab bodies mount as sandboxed iframes; the node's profile
  // narrows a profile-scoped tab so an off-profile iframe never mounts.
  const pluginContributions = usePluginContributions(bareDeviceId, undefined, drone?.profile);
  // The list the plugin header strip renders; resolved here too so the strip's
  // keyboard navigation spans plugin tabs and a dead plugin tab falls back.
  const nodeDetailTabContributions = useDronePluginContributions(bareDeviceId, drone?.profile);

  // Select this drone in drone-manager so getSelectedProtocol() returns the
  // right protocol.
  useEffect(() => {
    if (isConnected) useDroneManager.getState().selectDrone(droneId);
  }, [droneId, isConnected]);

  if (!drone) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-text-secondary">{t("nodeNotFound", { id: droneId })}</p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("backToDashboard")}
        </Button>
      </div>
    );
  }

  // Resolve the visible surfaces from the node's profile + role + caps. Plain
  // computation (not a hook) so it can sit after the guard.
  const ctx: SurfaceContext = {
    droneId,
    drone,
    displayName,
    isConnected,
    firmwareType: managedDrones.get(droneId)?.vehicleInfo.firmwareType ?? null,
    agentDeviceId,
    agentIdentityKnown: agentDeviceId !== null || drone.agentIdentityKnown === true,
    relayReach,
    fcLinking,
    radioPresent,
    visionPresent,
    crsfPresent,
    role: caps?.role ?? drone.role ?? null,
    capabilitiesKnown: caps !== null,
    showLockedTabs: !showAgentTabs,
    isFeatureEnabled: (featureId: string) => (nodeFeatureIds ?? []).includes(featureId),
    atlasCapturing,
  };
  const surfaces = resolveSurfaces(ctx);
  const pluginIds = pluginTabIds(nodeDetailTabContributions);
  const { agentSubpage, requestedTab, resolved, visibleTab } = resolveNodeTab(
    activeTab,
    surfaces.map((s) => s.id),
    pluginIds,
  );

  const activeSurface = isPluginTabId(visibleTab)
    ? undefined
    : surfaces.find((s) => s.id === visibleTab);
  // NOT called here: the call must happen inside the error boundary's own
  // subtree or a throwing surface unwinds straight past it.
  const renderActiveBody = activeSurface ? () => activeSurface.render(ctx) : null;

  return (
    <PluginHostProvider deviceId={bareDeviceId} contributions={pluginContributions}>
      {agentSubpage && <AgentSubpageHandoff subpage={agentSubpage} />}
      <ImmersiveGuard visibleTab={visibleTab} />
      <TabMemory
        droneId={droneId}
        visibleTab={visibleTab}
        requestedTab={requestedTab}
        resolved={resolved}
      />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Hidden, not unmounted, in immersive mode: the connect chip owns the
            node's agent connection and must survive the toggle. */}
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-secondary flex-shrink-0",
            immersiveMode && "hidden",
          )}
        >
            <h1 className="text-sm font-semibold text-text-primary shrink-0">{displayName}</h1>
            {/* Flight vocabulary belongs to a node that flies. */}
            {drone.profile === "drone" && <DroneStatusBadge status={drone.status} />}
            <NodeConnectChip focusDeviceId={focusDeviceId} />
            <NodeAuthorityChip droneId={droneId} />
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              // Icon-only, so it needs an accessible name.
              aria-label={t("backToDashboard")}
              onClick={onClose}
            />
            <div className="w-px h-5 bg-border-default shrink-0" />
            <NodeTabStrip
              surfaces={surfaces}
              pluginIds={pluginIds}
              visibleTab={visibleTab}
              onSelect={setActiveTab}
              bareDeviceId={bareDeviceId}
              nodeProfile={drone.profile}
            />
            <NodeHeaderActions
              droneId={drone.id}
              displayName={displayName}
              isConnected={isConnected}
              isDroneProfile={drone.profile === "drone"}
              onClose={onClose}
            />
        </div>

        {/* The surface key carries BOTH the tab and the node id: the panel is
            not remounted per node, so keying on the tab alone would carry one
            node's surface state (and a dirty parameter edit) onto the next. */}
        {isPluginTabId(visibleTab) ? (
          <SurfaceErrorBoundary
            key={`${droneId}:${visibleTab}`}
            message={t("surfaceError")}
            retryLabel={t("surfaceErrorRetry")}
          >
            <DroneDetailTabBody
              agentId={bareDeviceId}
              activeTabId={visibleTab}
              nodeProfile={drone.profile}
            />
          </SurfaceErrorBoundary>
        ) : (
          <div
            id={`drone-tabpanel-${visibleTab}`}
            role="tabpanel"
            aria-labelledby={`drone-tab-${visibleTab}`}
            // Focusable so a keyboard operator can scroll a body with no
            // focusable content of its own (WCAG 2.1.1). The tabpanel is the
            // single scroll owner for content-height bodies.
            tabIndex={0}
            className="flex-1 min-h-0 overflow-y-auto flex flex-col"
          >
            <SurfaceErrorBoundary
              key={`${droneId}:${visibleTab}`}
              message={t("surfaceError")}
              retryLabel={t("surfaceErrorRetry")}
            >
              {renderActiveBody && <SurfaceBody render={renderActiveBody} />}
            </SurfaceErrorBoundary>
          </div>
        )}
      </div>
    </PluginHostProvider>
  );
}
