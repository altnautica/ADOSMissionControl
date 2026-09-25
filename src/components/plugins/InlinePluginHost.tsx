"use client";

/**
 * @module plugins/InlinePluginHost
 * @description Mounts a trusted inline GCS module (one that passed the inline
 * trust gate) into a host-owned element, with no iframe. The module talks to
 * the host through `host.ctx`, an in-memory channel into the same envelope
 * dispatcher the iframe bridge uses, so every call is gated exactly as an
 * iframe plugin's. The host pushes the same events the iframe host does
 * (theme, capability token, config, the plugin's agent state, the slot's host
 * event) and runs the module's disposer when it unmounts or the node changes.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { BridgeHandler, BridgeTokenValidatorOptions } from "@/lib/plugins/bridge";
import { createEnvelopeDispatcher } from "@/lib/plugins/envelope-dispatcher";
import {
  createInlineChannel,
  createInlineContext,
  type InlineChannel,
} from "@/lib/plugins/inline-context";
import { createInlineHostSession } from "@/lib/plugins/inline-host-api";
import type { InlineBundle } from "@/lib/plugins/inline-loader";
import { pluginClientForReach, resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import {
  agentStateOrigin,
  isReservedEventTopic,
  subscribePluginEvent,
} from "@/lib/plugins/event-bus";
import { pluginConfigKey, usePluginConfigCache } from "@/lib/plugins/config-cache";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { SurfaceErrorBoundary } from "@/components/dashboard/node-detail/SurfaceErrorBoundary";

import { useHostThemeVars } from "./host-theme-vars";
import { liveHandlers, liveValidator, refusalLogger } from "./live-bridge-inputs";

type PushEvent = (method: string, capability: string, args: unknown) => void;

interface InlinePluginHostProps {
  pluginId: string;
  panelId: string;
  /** Slot the module is mounted into (a data attribute). */
  slot: string;
  bundle: InlineBundle;
  grantedCapabilities: ReadonlySet<string>;
  handlers: Record<string, BridgeHandler>;
  /** Bare device id of the node the module is mounted for. */
  agentId?: string | null;
  tokenValidator?: BridgeTokenValidatorOptions;
  token?: string | null;
  hostEvent?: { method: string; capability: string; args: unknown };
  className?: string;
}

export function InlinePluginHost(props: InlinePluginHostProps) {
  const t = useTranslations("plugins");
  return (
    <SurfaceErrorBoundary message={t("inlineCrashed")} retryLabel={t("inlineRetry")}>
      <InlineMount {...props} />
    </SurfaceErrorBoundary>
  );
}

function InlineMount({
  pluginId,
  panelId,
  slot,
  bundle,
  grantedCapabilities,
  handlers,
  agentId = null,
  tokenValidator,
  token,
  hostEvent,
  className,
}: InlinePluginHostProps) {
  const t = useTranslations("plugins");
  const rootRef = useRef<HTMLDivElement>(null);
  const themeVars = useHostThemeVars();
  const nodeProfile = useNodeRegistryStore((s) =>
    agentId ? (s.nodes[nodeIdForDevice(agentId)]?.presence.profile ?? null) : null,
  );
  const [push, setPush] = useState<PushEvent | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Latest props behind refs so the mount survives parent re-renders; the
  // dispatcher reads them on every call (see `live-bridge-inputs`). The refs
  // are refreshed in a layout effect after each commit, which runs before the
  // mount effect below, so the mount always sees the current props.
  const handlersRef = useRef(handlers);
  const capsRef = useRef(grantedCapabilities);
  const validatorRef = useRef(tokenValidator);
  const tokenRef = useRef(token);
  const profileRef = useRef(nodeProfile);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
    capsRef.current = grantedCapabilities;
    validatorRef.current = tokenValidator;
    tokenRef.current = token;
    profileRef.current = nodeProfile;
  });
  const validatorEnabled = tokenValidator !== undefined;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let unmounted = false;
    let disposer: (() => void) | null = null;
    const runDisposer = (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        console.warn(`Plugin ${pluginId} disposer threw`, err);
      }
    };

    let channel: InlineChannel | null = null;
    const dispatcher = createEnvelopeDispatcher({
      pluginId,
      grantedCapabilities: () => capsRef.current,
      handlers: liveHandlers(handlersRef),
      tokenValidator: validatorEnabled ? liveValidator(validatorRef) : undefined,
      onSecurityEvent: refusalLogger(pluginId),
      // Delivered on a microtask so a response never re-enters the caller's
      // own stack, as a postMessage hop would not.
      post: (env) => queueMicrotask(() => channel?.receive(env)),
    });
    channel = createInlineChannel((env) => void dispatcher.dispatch(env));
    const session = createInlineHostSession({
      pluginId,
      panelId,
      bundle,
      deviceId: agentId,
      nodeProfile: profileRef.current,
      ctx: createInlineContext(channel.client),
    });
    // The token first, so the module's first request already carries it.
    if (tokenRef.current) dispatcher.pushEvent("capability.token", "", { token: tokenRef.current });

    Promise.resolve()
      .then(() => bundle.module.mount(root, session.api))
      .then(
        (fn) => {
          if (unmounted) runDisposer(fn);
          else {
            disposer = fn;
            setPush(() => dispatcher.pushEvent);
          }
        },
        (err: unknown) => {
          if (!unmounted) setMountError(err instanceof Error ? err.message : String(err));
        },
      );

    return () => {
      unmounted = true;
      setPush(null);
      // Cleared here rather than at the top of the effect: every re-run
      // (Retry, a new bundle or node) runs this cleanup first.
      setMountError(null);
      if (disposer) runDisposer(disposer);
      channel?.client.dispose();
      dispatcher.dispose();
      session.release();
      root.replaceChildren();
    };
  }, [bundle, pluginId, panelId, agentId, validatorEnabled, attempt]);

  // Host events, pushed once the module is mounted and on every change.
  useEffect(() => {
    if (push && themeVars) push("theme.changed", "theme.useTheme", themeVars);
  }, [push, themeVars]);
  useEffect(() => {
    if (push && token) push("capability.token", "", { token });
  }, [push, token]);
  useEffect(() => {
    if (push && hostEvent) push(hostEvent.method, hostEvent.capability, hostEvent.args);
  }, [push, hostEvent]);

  // Seed the plugin's config from the node's own read-back, as the iframe
  // host does, then deliver it (and every later write) as `config.changed`.
  useEffect(() => {
    if (!agentId || isDemoMode()) return;
    const reach = resolveNodeAgentReach(agentId);
    if (!reach) return;
    let cancelled = false;
    pluginClientForReach(reach)
      .getConfig(pluginId)
      .then((values) => {
        if (!cancelled) usePluginConfigCache.getState().seed(agentId, pluginId, values);
      })
      .catch(() => {
        // Unreadable (plugin host down, older agent): keep what is known.
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, pluginId]);
  const knownConfig = usePluginConfigCache((s) =>
    agentId ? s.values[pluginConfigKey(agentId, pluginId)] : undefined,
  );
  useEffect(() => {
    if (push && knownConfig) push("config.changed", "", knownConfig);
  }, [push, knownConfig]);

  // This plugin's own agent-published state on this node, as host events
  // whose method is the topic; host-reserved namespaces are never forwarded.
  useEffect(() => {
    if (!push || !agentId) return;
    const origin = agentStateOrigin(pluginId, agentId);
    return subscribePluginEvent("*", pluginId, (payload, topic, from) => {
      if (from !== origin || isReservedEventTopic(topic)) return;
      push(topic, "", payload);
    });
  }, [push, pluginId, agentId]);

  return (
    <div className={className} data-slot={slot} data-agent-id={agentId ?? undefined}>
      {mountError !== null && (
        <div
          role="alert"
          className="m-3 flex items-center justify-between gap-3 rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-text-primary"
        >
          <span>{t("inlineMountFailed", { name: pluginId, reason: mountError })}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="shrink-0 rounded border border-accent-primary/30 px-2 py-0.5 text-accent-primary hover:bg-accent-primary/10"
          >
            {t("inlineRetry")}
          </button>
        </div>
      )}
      <div
        ref={rootRef}
        data-plugin-root={pluginId}
        data-panel-id={panelId}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      />
    </div>
  );
}
