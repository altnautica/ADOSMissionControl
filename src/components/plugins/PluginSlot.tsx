"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { InlinePluginHost } from "./InlinePluginHost";
import { PluginIframeHost } from "./PluginIframeHost";
import { usePluginTokenValidator } from "./use-plugin-token-validator";

// Module-scoped dedupe set so the operator sees one toast per
// (plugin, slot) pair across the whole session. Without this the
// same denial would re-fire on every render of the host page.
const droppedNotified = new Set<string>();

type HostEvent = React.ComponentProps<typeof PluginIframeHost>["hostEvent"];

/**
 * Report contributions dropped at `slot` for a missing `ui.slot.*` grant, once
 * per (plugin, slot) for the session: a console warning and an operator
 * toast, so the denial does not disappear into the dev console. Reported
 * after render (never during it), keyed on the newline-joined plugin ids so a
 * slot that re-renders at frame rate does not repeat it.
 */
function useDroppedNotice(slot: PluginSlotName, droppedIds: string): void {
  const t = useTranslations("plugins");
  const { toast } = useToast();
  useEffect(() => {
    if (!droppedIds) return;
    const requiredCap = slotToCapability(slot);
    for (const pluginId of droppedIds.split("\n")) {
      const key = `${pluginId}::${slot}`;
      if (droppedNotified.has(key)) continue;
      droppedNotified.add(key);
      console.warn(`Plugin ${pluginId} cannot mount in slot ${slot}: missing ${requiredCap}`);
      toast(t("slotDroppedToast", { name: pluginId, slot }), "warning");
    }
  }, [droppedIds, slot, t, toast]);
}

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
   * Optional one-way host event streamed into every contribution the slot
   * mounts (e.g. the video-overlay host props). Forwarded verbatim to
   * each host.
   */
  hostEvent?: HostEvent;
}

/**
 * Mount point for plugin contributions at a well-known slot. Wires each
 * contribution through {@link PluginContributionMount}. The slot is
 * presentational: contributions flow in from the provider (or via the
 * `contributions` prop for testing).
 */
export function PluginSlot({
  name,
  contributions,
  emptyState,
  className,
  iframeClassName,
  hostEvent,
}: PluginSlotProps) {
  const fromContext = useSlotContributions(name);
  // Plugin contributions load client-side (from the install store), so the
  // server renders an empty slot while the client renders the iframes — a
  // hydration mismatch (and an empty-src iframe that trips the frame-src CSP).
  // Mount the iframes only after hydration: SSR + first client render both show
  // the empty state, then the slot fills post-mount (client-only, no mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
  useDroppedNotice(name, droppedIds);
  if (!mounted || list.length === 0) return <>{emptyState}</>;
  return (
    <div data-plugin-slot={name} className={className}>
      {list.map((c) => (
        <PluginContributionMount
          key={`${c.pluginId}::${c.panelId}`}
          slot={name}
          contribution={c}
          className={iframeClassName}
          hostEvent={hostEvent}
        />
      ))}
    </div>
  );
}

/**
 * Mount one contribution: the `ui.slot.*` capability gate, then the
 * token-validated mount (Convex available and the provider bound to a node)
 * or the plain one, then the sandboxed iframe or the trusted inline module by
 * the contribution's isolation. `className` sizes the iframe or the inline
 * mount element.
 */
export function PluginContributionMount({
  slot,
  contribution,
  className,
  hostEvent,
}: {
  slot: PluginSlotName;
  contribution: PluginSlotContribution;
  className?: string;
  hostEvent?: HostEvent;
}): ReactNode {
  const host = usePluginHost();
  const deviceId = host?.deviceId ?? null;
  // The validator path runs Convex hooks; tests and the local-first build
  // (no Convex backend) have no `<ConvexProvider>` in the tree. The branch is
  // stable per provider lifecycle, so React never sees the two alternate.
  const convexAvailable = useConvexAvailable();
  const granted = contribution.grantedCapabilities.has(slotToCapability(slot));
  useDroppedNotice(slot, granted ? "" : contribution.pluginId);
  if (!granted) return null;
  const props = { contribution, slot, className, hostEvent };
  return convexAvailable && deviceId !== null ? (
    <MountValidated {...props} deviceId={deviceId} />
  ) : (
    <ContributionBody {...props} deviceId={deviceId} />
  );
}

interface MountProps {
  contribution: PluginSlotContribution;
  slot: PluginSlotName;
  deviceId: string | null;
  className?: string;
  hostEvent?: HostEvent;
}

/**
 * Validator-on mount. Calls the Convex-aware token validator hook to build
 * the per-RPC verification options AND to obtain the minted token the plugin
 * must stamp onto its envelopes. Both halves come from one hook call: the
 * validator without the token would deny every RPC with `token_missing`.
 */
function MountValidated(props: MountProps & { deviceId: string }) {
  const c = props.contribution;
  // Tokens, verification keys and pairing keys are all keyed by the bare
  // agent device id; the host provider carries the fleet selection id.
  const agentDeviceId = deviceIdFromNodeId(props.deviceId) ?? props.deviceId;
  const { validator, token } = usePluginTokenValidator({
    pluginInstallId: c.pluginInstallId ?? c.pluginId,
    pluginId: c.pluginId,
    deviceId: agentDeviceId,
  });
  return <ContributionBody {...props} tokenValidator={validator} token={token} />;
}

/** The iframe or inline body. Without a validator the dispatcher runs in
 * capability-set-only mode. */
function ContributionBody({
  contribution: c,
  slot,
  deviceId,
  className,
  hostEvent,
  tokenValidator,
  token,
}: MountProps & Pick<React.ComponentProps<typeof PluginIframeHost>, "tokenValidator" | "token">) {
  if (c.isolation === "inline") {
    return (
      <InlineContribution
        contribution={c}
        slot={slot}
        deviceId={deviceId}
        className={className}
        hostEvent={hostEvent}
        tokenValidator={tokenValidator}
        token={token}
      />
    );
  }
  return (
    <PluginIframeHost
      pluginId={c.pluginId}
      slot={slot}
      bundleUrl={c.bundleUrl}
      grantedCapabilities={c.grantedCapabilities}
      handlers={c.handlers}
      title={c.title ?? `${c.pluginId} ${c.panelId}`}
      className={c.iframeClassName ?? className}
      agentId={deviceId}
      tokenValidator={tokenValidator}
      token={token}
      hostEvent={hostEvent}
    />
  );
}

/** An inline contribution by load state: a loading line, an error card with a
 * retry (never an iframe fallback), or the mounted module. */
function InlineContribution({
  contribution: c,
  slot,
  deviceId,
  className,
  hostEvent,
  tokenValidator,
  token,
}: MountProps & Pick<React.ComponentProps<typeof PluginIframeHost>, "tokenValidator" | "token">) {
  const t = useTranslations("plugins");
  const name = c.title ?? c.pluginId;
  const state = c.inline ?? { status: "loading" as const };
  if (state.status === "loading") {
    return (
      <div role="status" className="m-3 text-xs text-text-tertiary">
        {t("inlineLoading", { name })}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="m-3 flex items-center justify-between gap-3 rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-text-primary"
      >
        <span>{t("inlineLoadFailed", { name, reason: state.message })}</span>
        <button
          type="button"
          onClick={state.retry}
          className="shrink-0 rounded border border-accent-primary/30 px-2 py-0.5 text-accent-primary hover:bg-accent-primary/10"
        >
          {t("inlineRetry")}
        </button>
      </div>
    );
  }
  return (
    <InlinePluginHost
      pluginId={c.pluginId}
      panelId={c.panelId}
      slot={slot}
      bundle={state.bundle}
      grantedCapabilities={c.grantedCapabilities}
      handlers={c.handlers}
      agentId={deviceId === null ? null : (deviceIdFromNodeId(deviceId) ?? deviceId)}
      tokenValidator={tokenValidator}
      token={token}
      hostEvent={hostEvent}
      className={className}
    />
  );
}
