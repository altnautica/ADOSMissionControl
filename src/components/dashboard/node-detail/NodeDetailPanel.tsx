"use client";

/**
 * @module node-detail/NodeDetailPanel
 * @description The unified per-node detail panel for the Dashboard, central
 * command for every agent profile (drone / ground-station / compute / future).
 * The header chrome + tab strip are profile-agnostic; the visible surfaces are
 * resolved from the node's profile + role + capabilities via the surface
 * registry (./surfaces). Built-in surfaces and plugin-contributed tabs share
 * one render path. Renamed from DroneDetailPanel; the old path re-exports this.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useForgetNode } from "@/hooks/use-forget-node";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { DroneStatusBadge } from "@/components/shared/drone-status-badge";
import { LinkUpPlaceholder } from "@/components/shared/link-up/LinkUpPlaceholder";
import {
  DroneDetailTabHeaders,
  DroneDetailTabBody,
  isPluginTabId,
} from "@/components/plugins/DroneDetailTabHost";
import { PluginHostProvider } from "@/components/plugins/PluginHostProvider";
import { SurfaceErrorBoundary } from "./SurfaceErrorBoundary";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { X, RotateCcw, Trash2, Lock } from "lucide-react";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { selectNode } from "@/lib/agent/node-click-handler";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { useAtlasReadinessStore } from "@/stores/atlas-readiness-store";
import { useAtlasControl } from "@/hooks/use-atlas-control";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import { ConnectionQualityMeter } from "@/components/indicators/ConnectionQualityMeter";
import { NavStatePill } from "@/components/indicators/NavStatePill";
import { RuntimeModeBadge } from "@/components/indicators/RuntimeModeBadge";
import { TrafficPill } from "@/components/indicators/TrafficPill";
import { useUiStore } from "@/stores/ui-store";
import { resolveSurfaces } from "./surfaces";
import { AGENT_SUBPAGE_IDS, agentRedirect } from "./agent/agent-redirect";
import type { SurfaceContext } from "./surface-types";

interface NodeDetailPanelProps {
  droneId: string;
  onClose: () => void;
}

export function NodeDetailPanel({ droneId, onClose }: NodeDetailPanelProps) {
  const t = useTranslations("dronePanel");
  const tLink = useTranslations("linkUp");
  // Namespace-less translator so a surface can reuse any existing key
  // (drone labels live under dronePanel.*, ground-station labels under
  // command.groundStation.tabs.*).
  const tRoot = useTranslations();
  const drones = useFleetStore((s) => s.drones);
  // Seed the first-open tab from the per-node last-tab (falling back to Overview).
  const [activeTab, setActiveTab] = useState(
    () => useUiPrefsStore.getState().getLastTab(droneId) ?? "overview",
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  // The shared forget action, with the Convex cloud-row delete already wired
  // so a removed cloud drone cannot re-feed from the reactive listMyDrones
  // query.
  const forget = useForgetNode();

  const drone = drones.find((d) => d.id === droneId);
  // This drone is backed by a companion-computer agent when the fleet row
  // carries the agent's device id (cloud-paired or LAN-paired projector).
  const agentDeviceId = drone?.cloudDeviceId ?? null;
  const fleetNodes = useFleetNodes();

  const radioPresent = useAgentCapabilitiesStore((s) => s.radio !== null);
  const crsfPresent = useAgentCapabilitiesStore((s) => s.crsf !== null);
  const visionPresent = useAgentCapabilitiesStore(
    (s) => s.visionAvailable === true,
  );
  // Ground-station role of the focused agent. The selected node IS the
  // focused agent (selection drives the connection), so the capabilities
  // store is authoritative; the fleet row's role is the synchronous fallback.
  const capRole = useAgentCapabilitiesStore((s) => s.role);

  // Atlas gating, sourced reactively so enabling the World Model feature or a
  // capture start/stop re-renders the tab strip live. The World Model tab shows
  // when the per-node feature is on; the Live World tab shows only while the
  // focused drone is capturing (one drone tab idle, two capturing).
  const atlasDeviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const atlasCapturing = useAtlasReadinessStore((s) =>
    s.isCapturing(atlasDeviceId),
  );
  // Per-node first-party feature opt-in state (reactive), keyed by the bare
  // device id. Gates the drone World Model + Live World surfaces: a feature is
  // off until the operator turns it on in the Status-tab Features toggle.
  const nodeFeatureIds = useNodeFeaturesStore((s) => s.enabled[atlasDeviceId]);
  // Populate the per-drone Atlas readiness from the panel level so the Live
  // World tab can auto-reveal while capturing regardless of which tab is open
  // (or after a refresh mid-capture — the readiness store is not persisted). The
  // hook self-gates its poll on the per-node World Model feature (it does no
  // network until the feature is enabled), so it is mounted for any drone-profile
  // node; the two Atlas tab components keep their own mounts for the capture
  // action callbacks.
  useAtlasControl((drone?.profile ?? "drone") === "drone" ? droneId : null);

  // Companion tabs (Health / Extensions) render only when this node is backed
  // by an agent (`agentDeviceId !== null`) — a full drone, ground station, or
  // workstation. An FC-only node (a direct MAVLink connection, no companion,
  // incl. the demo's FC-only drone) has nothing to show there, so they hide.
  const showAgentTabs = agentDeviceId !== null;
  const showLockedTabs = !showAgentTabs;

  // Focus the selected drone's agent so the (singleton) agent stores reflect
  // it. Selection is the single driver of the agent connection: switching
  // drones tears down the prior agent and connects the new one; deselecting
  // (panel unmount) releases it. Demo keeps its single mock agent untouched.
  const lastAgentDeviceId = useRef<string | null>(null);
  useEffect(() => {
    if (isDemoMode()) return;
    if (!agentDeviceId) {
      if (lastAgentDeviceId.current) {
        useAgentConnectionStore.getState().disconnect();
        lastAgentDeviceId.current = null;
      }
      return;
    }
    if (lastAgentDeviceId.current === agentDeviceId) return;
    const entry = fleetNodes.find((n) => n.deviceId === agentDeviceId);
    if (!entry) return;
    lastAgentDeviceId.current = agentDeviceId;
    void selectNode(entry, { onFocusAgent: () => {} });
  }, [agentDeviceId, fleetNodes]);
  useEffect(
    () => () => {
      if (!isDemoMode()) {
        useAgentConnectionStore.getState().disconnect();
        lastAgentDeviceId.current = null;
      }
    },
    [],
  );

  const metadata = useDroneMetadataStore((s) => s.profiles[droneId]);
  const managedDrones = useDroneManager((s) => s.drones);
  const isConnected = managedDrones.has(droneId);
  // The agent advertises an FC on a serial port (heartbeat) before the GCS has
  // finished dialing the live MAVLink session. During that window the Configure
  // tab should read "linking", not the hard "no FC / connect one" placeholder —
  // the agent clearly has a flight controller; we are mid-handshake.
  // An MSP FC (Betaflight/iNav) never sets fc_connected (no MAVLink heartbeat),
  // but once the agent has identified the variant and the transport is open it
  // IS a connectable flight controller — so count it as "linking" too, else the
  // Configure tab shows the "no FC / connect one" placeholder for a real FC.
  const agentStatus = useAgentSystemStore((s) => s.status);
  const agentFcReachable = isFcReachable({
    fcConnected: agentStatus?.fc_connected,
    fcVariant: agentStatus?.fc_variant,
    transportOpen: agentStatus?.transport_open,
  });
  const fcLinking = !isConnected && agentDeviceId !== null && agentFcReachable;

  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const exitImmersiveMode = useUiStore((s) => s.exitImmersiveMode);
  const pendingDetailTab = useUiStore((s) => s.pendingDetailTab);
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);

  const displayName = metadata?.displayName ?? drone?.name ?? droneId;

  // Live per-node plugin contributions feed the host provider so the
  // node.detail.tab bodies (and any other per-node GCS slots) mount as
  // sandboxed iframes. Inert until a plugin is installed + enabled +
  // granted; the headers strip resolves separately from the manifest. The
  // node's profile narrows a profile-scoped node.detail.tab so an off-profile
  // tab's iframe never mounts (e.g. a ground-station-only tab on a drone).
  const pluginContributions = usePluginContributions(
    droneId,
    undefined,
    drone?.profile,
  );

  // Consume pending detail tab from Cmd+K navigation
  useEffect(() => {
    if (pendingDetailTab) {
      setActiveTab(pendingDetailTab);
      setPendingDetailTab(null);
    }
  }, [pendingDetailTab, setPendingDetailTab]);

  // Migrate a persisted/deep-linked jump to a now-nested Agent sub-page: pin the
  // top tab to "agent" once and hand the sub-page to AgentTab, so the Agent
  // page's own per-node sub-page memory then takes over. Guarded so the
  // ground-station's top-level Radio tab is never captured (matches the
  // surfaceIds-based render remap below).
  useEffect(() => {
    const profile = drone?.profile ?? "drone";
    const isTopLevelRadio =
      activeTab === "radio" && profile === "ground-station";
    const sub = isTopLevelRadio ? undefined : AGENT_SUBPAGE_IDS[activeTab];
    if (sub) {
      setActiveTab("agent");
      useUiStore.getState().setPendingAgentPanel(sub);
    }
  }, [activeTab, drone?.profile]);

  // Exit immersive mode if the tab changes away from the immersive surface.
  // Immersive full-bleed belongs to the `cockpit` tab.
  useEffect(() => {
    if (immersiveMode && activeTab !== "cockpit") {
      exitImmersiveMode();
    }
  }, [activeTab, immersiveMode, exitImmersiveMode]);

  // Remember the last tab per node so re-opening returns to it.
  useEffect(() => {
    useUiPrefsStore.getState().setLastTab(droneId, activeTab);
  }, [droneId, activeTab]);

  // Select this drone in drone-manager so getSelectedProtocol() returns the right protocol
  useEffect(() => {
    if (isConnected) {
      useDroneManager.getState().selectDrone(droneId);
    }
  }, [droneId, isConnected]);

  function handleDelete() {
    // One atomic forget across every source (agent connection + managed FC +
    // Convex cloud row + LAN credential + registry presence). This is the fix
    // for the "removed drone instantly reconnects" bug: the old path poked the
    // cosmetic fleet-store (overwritten by the projection on the next tick) and
    // gated the durable removal on a LAN entry a cloud-only drone never has, so
    // the Convex row survived and listMyDrones re-fed it. The shared hook
    // deletes the Convex row + drops registry presence so the projection re-run
    // finds nothing. `convexId` is the cloud doc id when cloud-paired.
    const convexId = fleetNodes.find((n) => n._id === droneId)?.convexId ?? null;
    forget(droneId, { convexId });
    setDeleteOpen(false);
    toast(`Drone "${displayName}" removed`, "warning");
    onClose();
  }

  if (!drone) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-text-secondary">
          Drone &quot;{droneId}&quot; not found
        </p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("backToDashboard")}
        </Button>
      </div>
    );
  }

  // Resolve the visible surfaces from the node's profile + role + caps. Plain
  // computation (not a hook) so it can sit after the guard; resolveSurfaces is
  // a cheap filter over the profile's descriptor list.
  const agentIdentityKnown =
    agentDeviceId !== null || drone.agentIdentityKnown === true;
  const ctx: SurfaceContext = {
    droneId,
    drone,
    displayName,
    isConnected,
    firmwareType: managedDrones.get(droneId)?.vehicleInfo.firmwareType ?? null,
    agentDeviceId,
    agentIdentityKnown,
    fcLinking,
    radioPresent,
    visionPresent,
    crsfPresent,
    role: capRole ?? drone.role ?? null,
    showLockedTabs,
    isFeatureEnabled: (featureId: string) =>
      (nodeFeatureIds ?? []).includes(featureId),
    atlasCapturing,
  };
  const surfaces = resolveSurfaces(ctx);
  const surfaceIds = surfaces.map((s) => s.id);

  // Redirect a persisted/deep-linked id that moved into the Agent page (the
  // former companion-computer tabs + Perception + Link, and the legacy
  // Flights/Black Box) to the "agent" top tab. agentRedirect guards on
  // surfaceIds so a profile that still owns the id at top level (the
  // ground-station Radio tab) keeps it.
  const agentSubpage = agentRedirect(activeTab, surfaceIds);
  const requestedTab = agentSubpage ? "agent" : activeTab;

  // Fall the active tab back to the first surface when its surface is no
  // longer present (a conditional capability dropped, a role flipped, or a
  // plugin tab unmounted). Plugin tabs keep their own active id.
  const visibleTab = surfaceIds.includes(requestedTab)
    ? requestedTab
    : isPluginTabId(requestedTab)
      ? requestedTab
      : (surfaces[0]?.id ?? "overview");

  const tabs = surfaces.map((s) => ({
    id: s.id,
    label: tRoot(s.labelKey),
    locked: s.locked ? s.locked(ctx) : false,
  }));

  // Group consecutive surfaces that share a `group` key into sections for the
  // two-tier tab layout. Order is preserved (grouping never reorders); an
  // ungrouped surface falls into a trailing default group with no section
  // label, keeping back-compat with profiles that have not adopted groups.
  const DEFAULT_GROUP = "__ungrouped__";
  const tabGroups: { key: string; labelKey: string | null; ids: string[] }[] =
    [];
  for (const s of surfaces) {
    const key = s.group ?? DEFAULT_GROUP;
    const last = tabGroups[tabGroups.length - 1];
    if (last && last.key === key) {
      last.ids.push(s.id);
    } else {
      tabGroups.push({
        key,
        labelKey: s.group ?? null,
        ids: [s.id],
      });
    }
  }

  const activeSurface = isPluginTabId(visibleTab)
    ? undefined
    : surfaces.find((s) => s.id === visibleTab);
  const activeBody = activeSurface
    ? activeSurface.locked?.(ctx)
      ? (
        <LinkUpPlaceholder
          variant="locked"
          surface={tRoot(activeSurface.labelKey)}
          droneName={displayName}
        />
      )
      : activeSurface.render(ctx)
    : null;

  return (
    <PluginHostProvider deviceId={droneId} contributions={pluginContributions}>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Merged header + tabs bar */}
        {!immersiveMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-secondary flex-shrink-0">
            <h1 className="text-sm font-semibold text-text-primary shrink-0">{displayName}</h1>
            <DroneStatusBadge status={drone.status} />
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              onClick={onClose}
            />

            <div className="w-px h-5 bg-border-default shrink-0" />

            <div
              role="tablist"
              aria-label="Node detail"
              // `flex-1 min-w-0` lets the strip take the free row space and
              // SCROLL its own overflow — without it the strip expands to its
              // full content width and shoves the right-side header actions
              // (ID / Delete / Reboot) off-screen on many-tab profiles.
              className="flex items-center self-stretch overflow-x-auto scrollbar-hide flex-1 min-w-0"
            >
              {/* Two-tier strip: each group renders a small section label
                  followed by its tab buttons. Arrow-key roving nav still spans
                  the whole flat `tabs` order so focus moves across sections. */}
              {tabGroups.map((group, groupIdx) => (
                <div
                  key={group.key}
                  className={cn(
                    "flex items-center self-stretch",
                    groupIdx > 0 &&
                      "ml-2 pl-2 border-l border-border-default/60",
                  )}
                >
                  {group.labelKey && (
                    <span className="self-center mr-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0">
                      {tRoot(group.labelKey)}
                    </span>
                  )}
                  {group.ids.map((id) => {
                    const tab = tabs.find((tt) => tt.id === id);
                    if (!tab) return null;
                    return (
                      <button
                        key={tab.id}
                        id={`drone-tab-${tab.id}`}
                        role="tab"
                        aria-selected={visibleTab === tab.id}
                        aria-controls={`drone-tabpanel-${tab.id}`}
                        tabIndex={visibleTab === tab.id ? 0 : -1}
                        onClick={() => setActiveTab(tab.id)}
                        onKeyDown={(e) => {
                          // Roving-tabindex + arrow-key nav per WAI-ARIA tab
                          // pattern. Left/Right/Home/End move + activate
                          // across the full flat tab order (all sections).
                          const idsArr = tabs.map((tt) => tt.id);
                          const idx = idsArr.indexOf(visibleTab);
                          let nextIdx = idx;
                          if (e.key === "ArrowRight") {
                            nextIdx = (idx + 1) % idsArr.length;
                          } else if (e.key === "ArrowLeft") {
                            nextIdx = (idx - 1 + idsArr.length) % idsArr.length;
                          } else if (e.key === "Home") {
                            nextIdx = 0;
                          } else if (e.key === "End") {
                            nextIdx = idsArr.length - 1;
                          } else {
                            return;
                          }
                          e.preventDefault();
                          const nextId = idsArr[nextIdx];
                          setActiveTab(nextId);
                          requestAnimationFrame(() => {
                            document
                              .getElementById(`drone-tab-${nextId}`)
                              ?.focus();
                          });
                        }}
                        title={
                          tab.locked
                            ? tLink("locked.title", { surface: tab.label })
                            : undefined
                        }
                        className={cn(
                          "self-stretch flex items-center gap-1 px-2.5 text-xs font-medium transition-colors cursor-pointer shrink-0 -mb-px border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                          visibleTab === tab.id
                            ? "text-accent-primary border-accent-primary"
                            : tab.locked
                              ? "text-text-tertiary hover:text-text-secondary border-transparent"
                              : "text-text-secondary hover:text-text-primary border-transparent",
                        )}
                      >
                        {tab.locked && (
                          <Lock size={10} className="opacity-70" />
                        )}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              ))}
              {/* Plugin-contributed drone-detail tabs render after the
                  static strip, sorted by manifest `order` then pluginId.
                  Only the tab headers live here; the body is rendered
                  inside the tabpanel switch below so the lazy mount
                  stays in sync with the static-tab switcher. */}
              <DroneDetailTabHeaders
                agentId={droneId}
                activeTabId={visibleTab}
                onSelectPluginTab={setActiveTab}
                nodeProfile={drone.profile}
              />
            </div>

            <span className="text-[10px] font-mono text-text-tertiary ml-auto shrink-0">
              ID: {drone.id}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={() => setDeleteOpen(true)}
              className="text-status-error hover:text-status-error shrink-0"
              title="Remove this node"
            >
              {t("delete")}
            </Button>
            <RuntimeModeBadge />
            {isConnected && <NavStatePill />}
            {isConnected && <TrafficPill />}
            {isConnected && <ConnectionQualityMeter />}
            {isConnected && (
              <Button
                variant="danger"
                size="sm"
                icon={<RotateCcw size={12} />}
                onClick={() => {
                  const protocol = useDroneManager.getState().getSelectedProtocol();
                  if (protocol) protocol.reboot();
                }}
              >
                {t("rebootFc")}
              </Button>
            )}
          </div>
        )}

        {/* Tab content. Plugin-contributed tabs render their own
            <div role="tabpanel"> via DroneDetailTabBody so the aria
            association resolves to the plugin's iframe wrapper. Built-in
            surfaces share the panel div below. */}
        {isPluginTabId(visibleTab) ? (
          <SurfaceErrorBoundary
            key={visibleTab}
            message={t("surfaceError")}
            retryLabel={t("surfaceErrorRetry")}
          >
            <DroneDetailTabBody
              agentId={droneId}
              activeTabId={visibleTab}
              nodeProfile={drone.profile}
            />
          </SurfaceErrorBoundary>
        ) : (
          <div
            id={`drone-tabpanel-${visibleTab}`}
            role="tabpanel"
            aria-labelledby={`drone-tab-${visibleTab}`}
            // The tabpanel is the single scroll owner: content-height bodies
            // (the GS device tabs, LogsTab, the overviews) scroll here, while
            // self-scrolling `h-full` bodies (ComputeOverview, the FC panels,
            // the flight HUD) fill exactly and manage their own scroll — so no
            // double scrollbar. Previously `overflow-hidden`, which clipped any
            // body that did not bring its own scroll container.
            className="flex-1 min-h-0 overflow-y-auto flex flex-col"
          >
            <SurfaceErrorBoundary
              key={visibleTab}
              message={t("surfaceError")}
              retryLabel={t("surfaceErrorRetry")}
            >
              {activeBody}
            </SurfaceErrorBoundary>
          </div>
        )}

        <ConfirmDialog
          open={deleteOpen}
          onConfirm={handleDelete}
          onCancel={() => setDeleteOpen(false)}
          title={t("deleteDrone")}
          message={t("deleteConfirm", { name: displayName })}
          confirmLabel={t("delete")}
          variant="danger"
        />
      </div>
    </PluginHostProvider>
  );
}
