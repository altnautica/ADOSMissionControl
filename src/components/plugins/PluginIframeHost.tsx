"use client";

import { useEffect, useRef } from "react";

import {
  createPluginBridge,
  type BridgeHandler,
  type BridgeTokenValidatorOptions,
} from "@/lib/plugins/bridge";
import { isDemoMode } from "@/lib/utils";
import {
  agentStateOrigin,
  isReservedEventTopic,
  subscribePluginEvent,
} from "@/lib/plugins/event-bus";
import {
  pluginConfigKey,
  usePluginConfigCache,
} from "@/lib/plugins/config-cache";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";

import { useHostThemeVars } from "./host-theme-vars";
import { liveHandlers, liveValidator, refusalLogger } from "./live-bridge-inputs";

interface PluginIframeHostProps {
  pluginId: string;
  /** Slot the iframe is mounted into. Used as a data-attribute and by handlers. */
  slot: string;
  /** Blob URL to the plugin bundle. Carries CSP headers from the host. */
  bundleUrl: string;
  /** Capability ids the plugin currently holds. */
  grantedCapabilities: ReadonlySet<string>;
  /** Method handlers; the bridge dispatches RPC calls into these. */
  handlers: Record<string, BridgeHandler>;
  /** Title for assistive tech. Defaults to pluginId. */
  title?: string;
  /** Width/height controlled by the parent slot; iframe fills its box. */
  className?: string;
  /**
   * Optional drone id the iframe is bound to: its config is read from and
   * its agent-published state forwarded for this drone.
   */
  agentId?: string | null;
  /**
   * Optional token validator wired into the bridge. When set, every
   * iframe RPC envelope MUST carry a signed capability token; the
   * bridge runs the 5-check verification pipeline before dispatch.
   * Built by the parent component (e.g. via `usePluginTokenValidator`)
   * and passed through as a stable object reference for the bridge effect.
   *
   * A validator without a matching {@link token} denies every RPC with
   * `token_missing`, so the two MUST be supplied together from one mint.
   */
  tokenValidator?: BridgeTokenValidatorOptions;
  /**
   * The minted capability token for this (plugin, node) pair. Published
   * into the iframe as a `capability.token` event on load and on every
   * change, which is how the plugin SDK learns the value it must stamp
   * onto each RPC envelope. `null` while a mint is in flight.
   *
   * This is the delivery half of {@link tokenValidator}: the bridge
   * verifies `env.token`, and nothing else in the host tells the iframe
   * what that value is.
   */
  token?: string | null;
  /**
   * Optional one-way host event streamed into the iframe as a bridge
   * `event` whenever its identity changes — the same mechanism theme
   * vars use, generalized. The slot owner (e.g. the video overlay host)
   * supplies the latest payload; the host re-posts it on iframe load and
   * on every change. Events are not capability-gated.
   */
  hostEvent?: {
    method: string;
    capability: string;
    args: unknown;
  };
}

/**
 * Sandboxed plugin iframe.
 *
 * The iframe runs in `sandbox="allow-scripts"` (no allow-same-origin) so the
 * bundle has a null origin and cannot read the host's storage, carries an empty
 * `allow` so no Permissions-Policy feature is delegated to it, and loads a
 * document that declares the `plugins/iframe-csp` policy — `default-src 'none'`
 * with `connect-src 'none'`, so it cannot open a network connection. Every I/O
 * round-trips through the postMessage bridge where the host enforces capability
 * checks.
 *
 * The network half is load-bearing and non-obvious: the frame's `src` is a
 * `blob:` URL, and a blob document inherits its creator's CSP. The app's own
 * policy must allow bare `http:`/`ws:` to reach LAN agents at arbitrary
 * RFC1918 addresses, so inheritance alone would give a sandboxed plugin full
 * outbound reach. The in-document policy injected by `buildIframeHtml` /
 * `ensurePluginFrameCsp` is what closes that.
 *
 * Capability tokens are one-way (host -> iframe) via `capability.token`, and
 * theming via `theme.changed`, both on the bridge's event channel. Plugins
 * subscribe to the theme via `ctx.theme.onChange(...)`.
 *
 * The iframe has no pause/resume protocol: a drone switch or tab switch
 * unmounts it, so a plugin persists anything it needs as it goes.
 *
 * Every RPC the bridge refuses is logged once per (reason, method) for the
 * iframe's lifetime, so a plugin failing its calls leaves a trace without
 * flooding the console. Messages from other frames are not this plugin's
 * doing and are not logged.
 */
export function PluginIframeHost({
  pluginId,
  slot,
  bundleUrl,
  grantedCapabilities,
  handlers,
  title,
  className,
  agentId,
  tokenValidator,
  token,
  hostEvent,
}: PluginIframeHostProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const themeVars = useHostThemeVars();

  // Refs hold the latest handler set + cap set so the bridge
  // effect can stay attached across parent re-renders even when the
  // parent passes fresh object identities. Without this, every render
  // would dispose-and-recreate the bridge, dropping in-flight RPC.
  const handlersRef = useRef(handlers);
  const capsRef = useRef(grantedCapabilities);
  // The validator also lives behind a ref so token-refresh callbacks
  // and updated secret resolvers take effect without tearing down the
  // bridge. The bridge sees a stable wrapper that delegates to the
  // ref's `current` on every dispatch.
  const validatorRef = useRef<BridgeTokenValidatorOptions | undefined>(
    tokenValidator,
  );
  handlersRef.current = handlers;
  capsRef.current = grantedCapabilities;
  validatorRef.current = tokenValidator;
  // Bridge effect keys only on whether a validator is configured. The
  // validator's internals (resolver function identity, onTokenExpired
  // closure) can change every render without forcing a rebuild because
  // the wrapper below reads them through `validatorRef.current`.
  const validatorEnabled = tokenValidator !== undefined;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = createPluginBridge({
      pluginId,
      // The live getter form lets grant/revoke take effect without
      // re-mounting the bridge.
      grantedCapabilities: () => capsRef.current,
      iframe,
      handlers: liveHandlers(handlersRef),
      onSecurityEvent: refusalLogger(pluginId),
      tokenValidator: validatorEnabled ? liveValidator(validatorRef) : undefined,
    });
    return () => bridge.dispose();
  }, [pluginId, validatorEnabled]);

  // Stream theme vars to the iframe once it loads, and on every change.
  // Captures the iframe element by reference so the cleanup detaches
  // from the same node we attached to, even if the ref later swaps.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !themeVars) return;
    const post = () => {
      iframe.contentWindow?.postMessage(
        {
          id: "theme-" + Date.now(),
          type: "event",
          method: "theme.changed",
          capability: "theme.useTheme",
          args: themeVars,
          version: 1,
        },
        "*",
      );
    };
    iframe.addEventListener("load", post);
    post();
    return () => {
      iframe.removeEventListener("load", post);
    };
  }, [themeVars]);

  // Publish the minted capability token into the iframe on load and on every
  // change, over the same one-way channel theme vars use. The bridge verifies
  // `env.token` on every RPC but never tells the iframe what that value is —
  // without this post, a validated iframe's every call is answered
  // `capability_denied:token_missing`. Re-posting on `load` covers the mint
  // resolving before the document is ready; re-posting on change covers a
  // refresh after a verifier-side expiry.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !token) return;
    const post = () => {
      iframe.contentWindow?.postMessage(
        {
          id: "token-" + Date.now(),
          type: "event",
          method: "capability.token",
          capability: "",
          args: { token },
          version: 1,
        },
        "*",
      );
    };
    iframe.addEventListener("load", post);
    post();
    return () => {
      iframe.removeEventListener("load", post);
    };
  }, [token]);

  // Seed the plugin's config from the agent's own read-back on mount, so a
  // setting written in an earlier session (or from another GCS) reaches the
  // plugin's UI. A drone with no LAN agent leaves the plugin on its defaults
  // until a write here records a value.
  useEffect(() => {
    if (!agentId || isDemoMode()) return;
    const agent = resolveLanAgent(agentId);
    if (!agent) return;
    let cancelled = false;
    new PluginAgentClient(agent.agentUrl, agent.apiKey)
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

  // Deliver the plugin's per-drone config (the agent's read-back plus every
  // value written since, from the plugin itself, the native parameter panel or
  // the Skill Bar) as a `config.changed` event, on load and after every
  // accepted write, so the plugin's UI reflects a setting changed anywhere.
  // The SDK's `ctx.config.onChange` listens for this event.
  const knownConfig = usePluginConfigCache((s) =>
    agentId ? s.values[pluginConfigKey(agentId, pluginId)] : undefined,
  );
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !knownConfig) return;
    const post = () => {
      iframe.contentWindow?.postMessage(
        {
          id: "config-" + Date.now(),
          type: "event",
          method: "config.changed",
          capability: "",
          args: knownConfig,
          version: 1,
        },
        "*",
      );
    };
    iframe.addEventListener("load", post);
    post();
    return () => {
      iframe.removeEventListener("load", post);
    };
  }, [knownConfig]);

  // Forward this plugin's own agent-published state (republished on the bus
  // by the state egress under the plugin's agent-state origin for this drone)
  // as host events whose method is the topic, which is what the SDK's
  // `ctx.events.subscribe(topic)` listens for. Only this plugin's own state on
  // this drone reaches it, so no grant is needed; host-reserved namespaces are
  // never forwarded so a state topic cannot pose as a host push.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !agentId) return;
    const origin = agentStateOrigin(pluginId, agentId);
    return subscribePluginEvent("*", pluginId, (payload, topic, from) => {
      if (from !== origin || isReservedEventTopic(topic)) return;
      iframe.contentWindow?.postMessage(
        {
          id: "state-" + Date.now(),
          type: "event",
          method: topic,
          capability: "",
          args: payload,
          version: 1,
        },
        "*",
      );
    });
  }, [pluginId, agentId]);

  // Stream the latest host event to the iframe (e.g. video-overlay host
  // props). Re-posts on every change and once on iframe load so an overlay
  // that mounts mid-stream still receives the current payload. One-way and
  // not capability-gated, mirroring the theme-vars channel.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !hostEvent) return;
    const post = () => {
      iframe.contentWindow?.postMessage(
        {
          id: "hostevent-" + Date.now(),
          type: "event",
          method: hostEvent.method,
          capability: hostEvent.capability,
          args: hostEvent.args,
          version: 1,
        },
        "*",
      );
    };
    iframe.addEventListener("load", post);
    post();
    return () => {
      iframe.removeEventListener("load", post);
    };
  }, [hostEvent]);

  // An empty bundle URL would render `<iframe src="">`, which loads nothing and
  // trips the `frame-src` CSP ("Framing '' violates ..."). A plugin with no
  // resolvable bundle has nothing to show, so render nothing instead.
  if (!bundleUrl) return null;

  return (
    <iframe
      ref={iframeRef}
      src={bundleUrl}
      sandbox="allow-scripts"
      // No delegated permissions: an empty `allow` denies every
      // Permissions-Policy-gated feature (camera, microphone, geolocation,
      // usb, serial, …) to the frame regardless of what the page holds.
      allow=""
      // The frame must not leak the operator's URL (which carries node ids)
      // to anything it references.
      referrerPolicy="no-referrer"
      title={title ?? pluginId}
      data-plugin-id={pluginId}
      data-slot={slot}
      data-agent-id={agentId ?? undefined}
      className={className}
    />
  );
}
