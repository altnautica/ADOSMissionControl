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
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
  capabilityPresence,
} from "@/stores/agent-capabilities-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { DroneStatusBadge } from "@/components/shared/drone-status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { useNodeControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import {
  DroneDetailTabHeaders,
  DroneDetailTabBody,
  isPluginTabId,
  pluginTabIds,
} from "@/components/plugins/DroneDetailTabHost";
import { PluginHostProvider } from "@/components/plugins/PluginHostProvider";
import { SurfaceErrorBoundary, SurfaceBody } from "./SurfaceErrorBoundary";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { useDronePluginContributions } from "@/hooks/use-drone-plugin-contributions";
import { X, RotateCcw, Trash2, MonitorPlay, PlugZap } from "lucide-react";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { useNodeConnect } from "./use-node-connect";
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
import { agentRedirect, topLevelAlias } from "./agent/agent-redirect";
import type { SurfaceContext } from "./surface-types";
import {
  type RelayReach,
  resolveRelayReach,
} from "@/lib/nodes/relay-reach";

interface NodeDetailPanelProps {
  droneId: string;
  onClose: () => void;
}

/**
 * Commits the one side effect of the Agent deep-link redirect. It is a
 * component rather than an effect in `NodeDetailPanel` because the redirect
 * decision depends on the profile's resolved `surfaceIds`, which are only
 * available after the panel's `!drone` guard — and a hook cannot live after an
 * early return. Mounting it only when the redirect fires keeps `agentRedirect`
 * the single decision point and runs the handoff once per redirect.
 */
function AgentSubpageHandoff({ subpage }: { subpage: string }) {
  useEffect(() => {
    useUiStore.getState().setPendingAgentPanel(subpage);
  }, [subpage]);
  return null;
}

/**
 * Persists the node's tab, and scrolls it into view in the overflowing strip.
 *
 * Both need `visibleTab` — the id the node actually RESOLVED — which is only
 * known after the panel's `!drone` guard, so like `AgentSubpageHandoff` this is
 * a mounted child rather than an effect in the panel body.
 *
 * `resolved` is false when the node could not offer the requested tab and the
 * panel fell back to the first surface. Persisting in that case would destroy
 * the operator's remembered position the moment a capability blipped (or the
 * first time they opened a node whose remembered tab had not re-appeared yet),
 * which is exactly how a workstation's record ended up holding `cockpit`.
 */
function TabMemory({
  droneId,
  visibleTab,
  requestedTab,
  resolved,
}: {
  droneId: string;
  visibleTab: string;
  requestedTab: string;
  resolved: boolean;
}) {
  useEffect(() => {
    if (!resolved) return;
    useUiPrefsStore.getState().setLastTab(droneId, requestedTab);
  }, [droneId, requestedTab, resolved]);
  useEffect(() => {
    // The strip hides its scrollbar, so a restored tab off the left edge reads
    // as "the panel is showing the wrong content" with no hint more exists.
    document
      .getElementById(`drone-tab-${visibleTab}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [visibleTab]);
  return null;
}

/**
 * Leaves immersive mode when the resolved surface is not the cockpit.
 *
 * Keyed on `visibleTab`, not the requested tab: switching from a drone parked
 * on Cockpit to a workstation leaves the request at `cockpit` while the panel
 * renders the workstation Overview, and gating on the request left the
 * operator full-bleed on a surface with no chrome and no way back.
 */
function ImmersiveGuard({ visibleTab }: { visibleTab: string }) {
  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const exitImmersiveMode = useUiStore((s) => s.exitImmersiveMode);
  useEffect(() => {
    if (immersiveMode && visibleTab !== "cockpit") exitImmersiveMode();
  }, [visibleTab, immersiveMode, exitImmersiveMode]);
  return null;
}

export function NodeDetailPanel({ droneId, onClose }: NodeDetailPanelProps) {
  const t = useTranslations("dronePanel");
  // Namespace-less translator so a surface can reuse any existing key
  // (drone labels live under dronePanel.*, ground-station labels under
  // command.groundStation.tabs.*).
  const tRoot = useTranslations();
  const drones = useFleetStore((s) => s.drones);
  // Seed the first-open tab from the per-node last-tab (falling back to
  // Overview), and RESEED it whenever the selected node changes. The panel is
  // deliberately not remounted per node (no `key` at the call site: the plugin
  // host's pause grace and the Agent page's sub-page memory both depend on the
  // instance surviving), so a lazy initializer alone would carry node A's tab
  // onto node B and the persist effect would then write it into B's record.
  const [activeTab, setActiveTab] = useState(
    () => useUiPrefsStore.getState().getLastTab(droneId) ?? "overview",
  );
  const seededForNode = useRef(droneId);
  if (seededForNode.current !== droneId) {
    seededForNode.current = droneId;
    setActiveTab(useUiPrefsStore.getState().getLastTab(droneId) ?? "overview");
  }
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rebootOpen, setRebootOpen] = useState(false);
  const { toast } = useToast();
  const { isHardBlocked, hardBlockMessage } = useArmedLock();

  // A reboot the FC refuses (armed, busy, unsupported) must not read as one
  // that happened, so the answer is always shown.
  const handleReboot = async () => {
    setRebootOpen(false);
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) {
      toast("No flight controller connected", "error");
      return;
    }
    try {
      const result = await protocol.reboot();
      toast(
        result.message || (result.success ? "Reboot command sent" : "The FC refused the reboot command"),
        result.success ? "success" : "error",
      );
    } catch {
      toast("Reboot command failed", "error");
    }
  };

  // The shared forget action, with the Convex cloud-row delete already wired
  // so a removed cloud drone cannot re-feed from the reactive listMyDrones
  // query.
  const forget = useForgetNode();

  const drone = drones.find((d) => d.id === droneId);
  // This drone is backed by a companion-computer agent when the fleet row
  // carries the agent's device id (cloud-paired or LAN-paired projector).
  const agentDeviceId = drone?.cloudDeviceId ?? null;
  const fleetNodes = useFleetNodes();

  // When this drone is reached ONLY through a ground node's WFB relay
  // (reachedVia = "node:<groundDeviceId>" and no direct cloudDeviceId), and
  // the ground node is LAN-paired with the GCS, the ground node's own
  // host + API key + the linked drone's device id form a relay-proxy reach.
  // The ground station's /api/v1/ground-station/relay-proxy/{peerId}/*
  // route forwards HTTP calls to the drone over the aux radio lane.
  const relayReach: RelayReach | null = resolveRelayReach({
    agentDeviceId,
    reachedVia: drone?.reachedVia,
    droneDeviceId: droneId,
  });

  // The reachable identity of THIS node's agent: direct when the GCS holds it,
  // else the relayed drone's own peer id. Also the key the connect effect is
  // idempotent on.
  const focusDeviceId = agentDeviceId ?? relayReach?.peerDeviceId ?? null;

  // Capability gates resolve from THIS node's remembered slice, never from the
  // process-wide focused one. Reading the focused slice painted node A's tabs
  // on node B for one frame, then `disconnect()` cleared the store and the
  // strip collapsed, then B's first heartbeat re-expanded it — two reflows per
  // node switch, with a clickable tab belonging to the previous node in
  // between. The per-device slice survives the disconnect, so B's own last
  // known gates paint on the first frame.
  const caps = useAgentCapabilitiesStore((s) =>
    selectDeviceCapabilities(s, focusDeviceId),
  );
  // Tri-state: a node this browser has never heard describe itself is
  // `unknown`, which is not `absent`. A surface must neither advertise the
  // capability nor claim the hardware is missing.
  const radioPresent = capabilityPresence(caps, (c) => c.radio !== null);
  const crsfPresent = capabilityPresence(caps, (c) => c.crsf !== null);
  const visionPresent = capabilityPresence(
    caps,
    (c) => c.visionAvailable === true,
  );
  // Ground-station role as this node last reported it; the fleet row's role is
  // the synchronous fallback for a node with no capability reading yet.
  const capRole = caps?.role;

  // Whether this browser may publish FC frames to THIS node. Surfaced on the
  // header rather than inside one tab, because every tab that writes to the
  // vehicle — parameters, mission, the flight controls — rides the same lane,
  // so a limit shown only on Overview would be missed by exactly the operator
  // about to use one of the others. Separate from `drone.status`, which is
  // liveness: a node can be online and uncommandable at the same time.
  const authority = useNodeControlAuthorityNotice(droneId);

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

  // Companion tabs (Health / Extensions) render when this node is backed by an
  // agent the GCS can actually reach — directly (`agentDeviceId !== null`) or
  // through its ground station's relay-proxy (`relayReach !== null`). An
  // FC-only node (a direct MAVLink connection, no companion, incl. the demo's
  // FC-only drone) has nothing to show there, so they hide.
  const showAgentTabs = agentDeviceId !== null || relayReach !== null;
  const showLockedTabs = !showAgentTabs;

  // Focus the selected drone's agent so the (singleton) agent stores reflect
  // it. The key is the reachable identity (`focusDeviceId`, resolved above),
  // not `agentDeviceId` alone: a relayed drone has no `agentDeviceId`.
  const focusEntry = fleetNodes.find((n) => n.deviceId === focusDeviceId) ?? null;
  const { connectFailing, retryNow } = useNodeConnect(focusDeviceId, focusEntry);

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
  // The same list `DroneDetailTabHeaders` renders, resolved here too so the
  // strip's roving keyboard navigation can span plugin tabs. The hook is
  // memoized per (node, profile), so the second call is a cache read rather
  // than a second query.
  const nodeDetailTabContributions = useDronePluginContributions(
    droneId,
    drone?.profile,
  );

  // Consume pending detail tab from Cmd+K navigation
  useEffect(() => {
    if (pendingDetailTab) {
      setActiveTab(pendingDetailTab);
      setPendingDetailTab(null);
    }
  }, [pendingDetailTab, setPendingDetailTab]);

  // The Agent deep-link redirect lives in exactly one place: `agentRedirect`,
  // called once during render (below) and guarded on the profile's live
  // `surfaceIds`. There used to be a second copy here, an effect guarded on a
  // hardcoded `activeTab === "radio" && profile === "ground-station"` string
  // instead. The two disagreed in two ways that an operator felt:
  //
  //  * On a ground station whose `radio` surface is gated off by its own
  //    `when` predicate, the string guard skipped while `agentRedirect`
  //    mapped radio -> agent, so the panel opened the Agent page WITHOUT the
  //    pending sub-page and landed on whatever it last remembered. The
  //    operator deep-linked to Radio and arrived somewhere else, silently.
  //  * The effect also called `setActiveTab("agent")`, which the persistence
  //    effect below then wrote to `setLastTab`, permanently rewriting the
  //    node's remembered tab to "agent" and discarding the deep-linked id.
  //
  // `visibleTab` already resolves the render to "agent" purely, so nothing
  // needs to mutate `activeTab`; the redirect's only side effect is handing
  // the sub-page to the Agent page, committed by `AgentSubpageHandoff`.

  // Immersive exit and the per-node tab memory both key on the RESOLVED tab,
  // which is only known after the `!drone` guard — they live in the mounted
  // `<ImmersiveGuard>` / `<TabMemory>` children below.

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
          {t("nodeNotFound", { id: droneId })}
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
    relayReach,
    fcLinking,
    radioPresent,
    visionPresent,
    crsfPresent,
    role: capRole ?? drone.role ?? null,
    capabilitiesKnown: caps !== null,
    showLockedTabs,
    isFeatureEnabled: (featureId: string) =>
      (nodeFeatureIds ?? []).includes(featureId),
    atlasCapturing,
  };
  const surfaces = resolveSurfaces(ctx);
  const surfaceIds = surfaces.map((s) => s.id);

  // Two migrations, in order. A retired id whose surface merged into a
  // sibling still at top level (Distributed RX -> Mesh & RX, Jobs/Viewer ->
  // Compute, Flights/Black Box -> Logs) resolves to the survivor FIRST, so it
  // is not pushed into the Agent page. What remains is the set that genuinely
  // moved inside the Agent page (the companion-computer tabs + Perception +
  // Link); `agentRedirect` guards on `surfaceIds` so a profile that still owns
  // an id at top level (the ground-station Radio tab) keeps it.
  const aliasedTab = topLevelAlias(activeTab, surfaceIds);
  const agentSubpage = agentRedirect(aliasedTab, surfaceIds);
  const requestedTab = agentSubpage ? "agent" : aliasedTab;

  // Fall the active tab back to the first surface when its surface is no
  // longer present (a conditional capability dropped, a role flipped, or a
  // plugin tab unmounted). Plugin tabs keep their own active id.
  const tabResolved =
    surfaceIds.includes(requestedTab) || isPluginTabId(requestedTab);
  const visibleTab = tabResolved
    ? requestedTab
    : (surfaces[0]?.id ?? "overview");

  const tabs = surfaces.map((s) => ({
    id: s.id,
    label: tRoot(s.labelKey),
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
  // NOT called here: the call must happen inside the error boundary's own
  // subtree or a throwing surface unwinds straight past it.
  const renderActiveBody = activeSurface
    ? () => activeSurface.render(ctx)
    : null;
  // The ordered id list the roving tab navigation spans: every built-in tab
  // AND every plugin tab. Built from `tabs` alone, the arrow keys wrapped
  // within the built-ins and plugin headers carry `tabIndex={-1}`, so there
  // was no keyboard path to a plugin tab at all.
  const stripIds = [
    ...tabs.map((tt) => tt.id),
    ...pluginTabIds(nodeDetailTabContributions),
  ];
  const moveTab = (key: string) => {
    const idx = stripIds.indexOf(visibleTab);
    let next = idx;
    if (key === "ArrowRight") next = (idx + 1) % stripIds.length;
    else if (key === "ArrowLeft")
      next = (idx - 1 + stripIds.length) % stripIds.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = stripIds.length - 1;
    else return false;
    const nextId = stripIds[next];
    setActiveTab(nextId);
    requestAnimationFrame(() => {
      document.getElementById(`drone-tab-${nextId}`)?.focus();
    });
    return true;
  };

  return (
    <PluginHostProvider deviceId={droneId} contributions={pluginContributions}>
      {agentSubpage && <AgentSubpageHandoff subpage={agentSubpage} />}
      <ImmersiveGuard visibleTab={visibleTab} />
      <TabMemory
        droneId={droneId}
        visibleTab={visibleTab}
        requestedTab={activeTab}
        resolved={tabResolved}
      />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Merged header + tabs bar */}
        {!immersiveMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-secondary flex-shrink-0">
            <h1 className="text-sm font-semibold text-text-primary shrink-0">{displayName}</h1>
            {/* Flight vocabulary belongs to a node that flies. A workstation
                or ground station reading "In Mission" / "Returning" off the
                shared fleet projection is the wrong domain entirely. */}
            {drone.profile === "drone" && (
              <DroneStatusBadge status={drone.status} />
            )}
            {connectFailing && (
              // Visible from every tab: the last connect did not reach this
              // node's agent. It is retried on its own; the button retries now.
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-status-error/40 bg-status-error/10 px-1.5 py-0.5 text-[10px] font-medium text-status-error">
                <PlugZap size={11} aria-hidden="true" />
                {tRoot("nodeConsole.hero.offline")}
                <button
                  type="button"
                  onClick={retryNow}
                  className="underline underline-offset-2 hover:text-status-error/80 cursor-pointer"
                >
                  {t("retryConnect")}
                </button>
              </span>
            )}
            {authority.show && (
              <span
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning"
                title={authority.detail}
              >
                <StatusDot
                  status={authority.level}
                  size="xs"
                  label={authority.detail}
                />
                {authority.label}
                <span className="sr-only">{authority.detail}</span>
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              // Icon-only, so without this the panel's close control announced
              // as an unnamed "button".
              aria-label={t("backToDashboard")}
              onClick={onClose}
            />

            <div className="w-px h-5 bg-border-default shrink-0" />

            <div
              role="tablist"
              aria-label={t("nodeDetailTabs")}
              // `flex-1 min-w-0` lets the strip take the free row space and
              // SCROLL its own overflow — without it the strip expands to its
              // full content width and shoves the right-side header actions
              // (ID / Delete / Reboot) off-screen on many-tab profiles.
              className="flex items-center self-stretch overflow-x-auto scrollbar-hide flex-1 min-w-0"
            >
              {/* Two-tier strip: each group renders a small section label
                  followed by its tab buttons. The wrapper is
                  `role="presentation"` so it leaves the accessibility tree
                  and the tablist still OWNS its tabs directly — a plain div
                  between a tablist and its tabs breaks that ownership, and a
                  screen reader then announces neither the tab count nor the
                  position. The section label is `aria-hidden` for the same
                  reason: it is decoration, and each tab's own text already
                  names it. */}
              {tabGroups.map((group, groupIdx) => (
                <div
                  key={group.key}
                  role="presentation"
                  className={cn(
                    "flex items-center self-stretch",
                    groupIdx > 0 &&
                      "ml-2 pl-2 border-l border-border-default/60",
                  )}
                >
                  {group.labelKey && (
                    <span
                      aria-hidden="true"
                      className="self-center mr-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0"
                    >
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
                          // pattern, spanning the WHOLE strip: built-in tabs
                          // and plugin tabs alike.
                          if (moveTab(e.key)) e.preventDefault();
                        }}
                        className={cn(
                          "self-stretch flex items-center gap-1 px-2.5 text-xs font-medium transition-colors cursor-pointer shrink-0 -mb-px border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                          visibleTab === tab.id
                            ? "text-accent-primary border-accent-primary"
                            : "text-text-secondary hover:text-text-primary border-transparent",
                        )}
                      >
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
                  stays in sync with the static-tab switcher. They share the
                  strip's roving navigation via `onNavigate` — a plugin tab
                  with no keyboard path is an entire third-party surface that
                  a gloved or keyboard-only operator cannot reach. */}
              <DroneDetailTabHeaders
                agentId={droneId}
                activeTabId={visibleTab}
                onSelectPluginTab={setActiveTab}
                nodeProfile={drone.profile}
                onNavigate={moveTab}
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
              title={tRoot("linkUp.cta.removeNode")}
            >
              {t("delete")}
            </Button>
            <RuntimeModeBadge />
            {isConnected && <NavStatePill />}
            {isConnected && <TrafficPill />}
            {isConnected && <ConnectionQualityMeter />}
            {isConnected && drone.profile === "drone" && (
              // `/hud` is the chromeless HDMI kiosk surface and had no entry
              // point anywhere in the app — the only way in was to type the
              // URL. It opens in a new tab deliberately: the route strips all
              // GCS chrome, so navigating in place would leave the operator
              // with no way back.
              <a
                href="/hud"
                target="_blank"
                rel="noopener noreferrer"
                title={t("openHud")}
                aria-label={t("openHud")}
                className="flex h-7 shrink-0 items-center gap-1 px-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-ring"
              >
                <MonitorPlay size={12} aria-hidden="true" />
              </a>
            )}
            {isConnected && (
              <Button
                variant="danger"
                size="sm"
                icon={<RotateCcw size={12} />}
                disabled={isHardBlocked}
                title={hardBlockMessage || undefined}
                onClick={() => setRebootOpen(true)}
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
        {/* The surface key carries BOTH the tab and the node id.

            `NodeDetailPanel` is not remounted when the operator switches the
            selected node — only its props change — so keying on `visibleTab`
            alone left every surface's component state alive across a node
            switch. With Configure open, switching drone A → B showed A's
            parameters under B's name, and `usePanelParams` resolves the
            protocol live at save time, so a carried-over dirty edit wrote A's
            numbers into B. `AgentTab` already worked around this locally with
            its own `key={ctx.droneId}`; keying here fixes every surface at
            once, which is where the invariant belongs. */}
        {isPluginTabId(visibleTab) ? (
          <SurfaceErrorBoundary
            key={`${droneId}:${visibleTab}`}
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
            // Focusable so a keyboard operator can scroll it: a long Logs
            // list or the GS device tabs have no focusable content of their
            // own, and arrow keys on the strip move between TABS (WCAG
            // 2.1.1).
            tabIndex={0}
            // The tabpanel is the single scroll owner: content-height bodies
            // (the GS device tabs, LogsTab, the overviews) scroll here, while
            // self-scrolling `h-full` bodies (ComputeOverview, the FC panels,
            // the flight HUD) fill exactly and manage their own scroll — so no
            // double scrollbar. Previously `overflow-hidden`, which clipped any
            // body that did not bring its own scroll container.
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

        <ConfirmDialog
          open={deleteOpen}
          onConfirm={handleDelete}
          onCancel={() => setDeleteOpen(false)}
          title={t("deleteDrone")}
          message={t("deleteConfirm", { name: displayName })}
          confirmLabel={t("delete")}
          variant="danger"
        />
        <ConfirmDialog
          open={rebootOpen}
          onConfirm={() => void handleReboot()}
          onCancel={() => setRebootOpen(false)}
          title={t("rebootFc")}
          message={t("rebootConfirm")}
          confirmLabel={t("reboot")}
          variant="danger"
          confirmDisabled={isHardBlocked}
        />
      </div>
    </PluginHostProvider>
  );
}
