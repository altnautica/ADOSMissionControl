"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useToast } from "@/components/ui/toast";
import { slotToCapability, type PluginSlotName } from "@/lib/plugins/types";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";

import {
  usePluginHost,
  useSlotContributions,
  type PluginSlotContribution,
} from "./PluginHostProvider";
import { PluginIframeHost } from "./PluginIframeHost";
import { usePluginTokenValidator } from "./use-plugin-token-validator";

// Module-scoped dedupe set so the operator sees one toast per
// (plugin, slot) pair across the whole session. Without this the
// same denial would re-fire on every render of the host page.
const droppedNotified = new Set<string>();

interface PluginSlotProps {
  name: PluginSlotName;
  /**
   * Optional explicit contributions list. When omitted, the slot
   * reads from the surrounding `<PluginHostProvider>`. Tests and
   * Storybook stories pass the list directly to skip the context.
   */
  contributions?: ReadonlyArray<PluginSlotContribution>;
  /**
   * Optional fallback when no plugin contributes to this slot. Hosts
   * pass operator-relevant copy; the slot itself stays mute by default.
   */
  emptyState?: React.ReactNode;
  /** Class applied to the wrapper around the iframe stack. */
  className?: string;
  /** Class applied to each iframe child. Slot owners control sizing. */
  iframeClassName?: string;
  /**
   * Optional one-way host event streamed into every iframe the slot
   * mounts (e.g. the video-overlay host props). Forwarded verbatim to
   * each `PluginIframeHost`.
   */
  hostEvent?: React.ComponentProps<typeof PluginIframeHost>["hostEvent"];
}

/**
 * Mount point for plugin contributions at a well-known slot. Wires
 * each contribution to its own sandboxed `<PluginIframeHost>`. The
 * slot is presentational: contributions flow in from the provider
 * (or via the `contributions` prop for testing).
 */
export function PluginSlot({
  name,
  contributions,
  emptyState,
  className,
  iframeClassName,
  hostEvent,
}: PluginSlotProps) {
  const t = useTranslations("plugins");
  const { toast } = useToast();
  const fromContext = useSlotContributions(name);
  const host = usePluginHost();
  const deviceId = host?.deviceId ?? null;
  // Plugin contributions load client-side (from the install store), so the
  // server renders an empty slot while the client renders the iframes — a
  // hydration mismatch (and an empty-src iframe that trips the frame-src CSP).
  // Mount the iframes only after hydration: SSR + first client render both show
  // the empty state, then the slot fills post-mount (client-only, no mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The validator path runs Convex hooks; tests and the local-first
  // build (no Convex backend) do not have a `<ConvexProvider>` in the
  // tree. We pick the mount component once per render based on the
  // availability context — it is stable per provider lifecycle, so
  // React never sees the two branches alternate.
  const convexAvailable = useConvexAvailable();
  const validatorEligible = convexAvailable && deviceId !== null;
  const raw = contributions ?? fromContext;
  // Capability gate: a contribution can only mount when its
  // grantedCapabilities include the slot's matching ui.slot.<id>
  // capability. Plugins missing the cap never had it granted at install
  // time, so the install record is the source of truth.
  const requiredCap = slotToCapability(name);
  const { list, droppedIds } = useMemo(() => {
    const kept: PluginSlotContribution[] = [];
    const dropped: string[] = [];
    for (const c of raw) {
      if (c.grantedCapabilities.has(requiredCap)) kept.push(c);
      else dropped.push(c.pluginId);
    }
    return { list: kept, droppedIds: dropped.join("\n") };
  }, [raw, requiredCap]);
  // A dropped contribution is reported once per (plugin, slot) for the
  // session: a console warning and an operator toast, so the denial does
  // not disappear into the dev console. Reported after render (never
  // during it), keyed on the dropped set so a slot that re-renders at
  // frame rate does not repeat it.
  useEffect(() => {
    if (!droppedIds) return;
    for (const pluginId of droppedIds.split("\n")) {
      const key = `${pluginId}::${name}`;
      if (droppedNotified.has(key)) continue;
      droppedNotified.add(key);
      console.warn(
        `Plugin ${pluginId} cannot mount in slot ${name}: missing ${requiredCap}`,
      );
      toast(t("slotDroppedToast", { name: pluginId, slot: name }), "warning");
    }
  }, [droppedIds, name, requiredCap, t, toast]);
  if (!mounted || list.length === 0) return <>{emptyState}</>;
  return (
    <div data-plugin-slot={name} className={className}>
      {list.map((c) =>
        validatorEligible && deviceId !== null ? (
          <PluginSlotMountValidated
            key={`${c.pluginId}::${c.panelId}`}
            contribution={c}
            slotName={name}
            deviceId={deviceId}
            iframeClassName={iframeClassName}
            hostEvent={hostEvent}
          />
        ) : (
          <PluginSlotMountPlain
            key={`${c.pluginId}::${c.panelId}`}
            contribution={c}
            slotName={name}
            deviceId={deviceId}
            iframeClassName={iframeClassName}
            hostEvent={hostEvent}
          />
        ),
      )}
    </div>
  );
}

interface PluginSlotMountProps {
  contribution: PluginSlotContribution;
  slotName: PluginSlotName;
  deviceId: string | null;
  iframeClassName?: string;
  hostEvent?: React.ComponentProps<typeof PluginIframeHost>["hostEvent"];
}

interface PluginSlotMountValidatedProps
  extends Omit<PluginSlotMountProps, "deviceId"> {
  /** Always present at the validated mount; the parent gates on
   * non-null before picking this component branch. */
  deviceId: string;
}

/**
 * Validator-on mount. Calls the Convex-aware token validator hook to
 * build the bridge's per-RPC verification options AND to obtain the
 * minted token the iframe must stamp onto its envelopes. Used when
 * Convex is available AND the slot is bound to a drone; the bridge then
 * runs the full 5-check verification pipeline on every iframe RPC.
 *
 * Both halves come from one hook call. Passing the validator without the
 * token would deny every RPC with `token_missing`.
 */
function PluginSlotMountValidated({
  contribution: c,
  slotName,
  deviceId,
  iframeClassName,
  hostEvent,
}: PluginSlotMountValidatedProps) {
  const installId = c.pluginInstallId ?? c.pluginId;
  // Tokens, verification keys and pairing keys are all keyed by the bare
  // agent device id; the host provider carries the fleet selection id.
  const agentDeviceId = deviceIdFromNodeId(deviceId) ?? deviceId;
  const { validator, token } = usePluginTokenValidator({
    pluginInstallId: installId,
    pluginId: c.pluginId,
    deviceId: agentDeviceId,
  });
  return (
    <PluginIframeHost
      pluginId={c.pluginId}
      slot={slotName}
      bundleUrl={c.bundleUrl}
      grantedCapabilities={c.grantedCapabilities}
      handlers={c.handlers}
      title={c.title ?? `${c.pluginId} ${c.panelId}`}
      className={c.iframeClassName ?? iframeClassName}
      agentId={deviceId}
      tokenValidator={validator}
      token={token}
      hostEvent={hostEvent}
    />
  );
}

/**
 * Validator-off mount. Skips the Convex-aware hook chain entirely so
 * fleet-wide slots and Convex-less test environments still render. The
 * bridge runs in legacy capability-set-only mode for these iframes.
 */
function PluginSlotMountPlain({
  contribution: c,
  slotName,
  deviceId,
  iframeClassName,
  hostEvent,
}: PluginSlotMountProps) {
  return (
    <PluginIframeHost
      pluginId={c.pluginId}
      slot={slotName}
      bundleUrl={c.bundleUrl}
      grantedCapabilities={c.grantedCapabilities}
      handlers={c.handlers}
      title={c.title ?? `${c.pluginId} ${c.panelId}`}
      className={c.iframeClassName ?? iframeClassName}
      agentId={deviceId}
      hostEvent={hostEvent}
    />
  );
}
