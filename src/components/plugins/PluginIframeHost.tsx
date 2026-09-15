"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import {
  createPluginBridge,
  type BridgeHandler,
  type BridgeTokenValidatorOptions,
} from "@/lib/plugins/bridge";
import { isDemoMode } from "@/lib/utils";

/** Maximum time the host will wait for a pause/resume ACK before proceeding. */
export const LIFECYCLE_ACK_TIMEOUT_MS = 300;

/**
 * Imperative API exposed via `ref`. The drone-switcher uses these to
 * gracefully pause the iframe (giving the plugin a chance to persist
 * state) before the React subtree unmounts.
 */
export interface PluginIframeHostHandle {
  /**
   * Post a `lifecycle.pause` event to the iframe and resolve once an
   * ACK is received, or after `LIFECYCLE_ACK_TIMEOUT_MS`, whichever is
   * first. In demo mode this short-circuits and resolves immediately.
   */
  pause: () => Promise<void>;
  /**
   * Post a `lifecycle.resume` event so the plugin can re-attach its
   * telemetry subscriptions for the newly-selected drone. Resolves on
   * ACK or after the same grace window.
   */
  resume: (opts?: { agentId?: string | null }) => Promise<void>;
  /** Direct iframe element access for parents that need it (e.g. focus). */
  getIframe: () => HTMLIFrameElement | null;
}

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
  /** Optional CSS variable map streamed to the plugin on mount. */
  themeVars?: Record<string, string>;
  /** Title for assistive tech. Defaults to pluginId. */
  title?: string;
  /** Width/height controlled by the parent slot; iframe fills its box. */
  className?: string;
  /** Optional security event sink (e.g. emit to plugin events log). */
  onSecurityEvent?: Parameters<typeof createPluginBridge>[0]["onSecurityEvent"];
  /**
   * Optional drone id the iframe is bound to. Sent as part of the
   * `lifecycle.resume` payload so per-drone plugins know which agent
   * they should subscribe to.
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

interface LifecyclePayload {
  type: "lifecycle";
  method: "pause" | "resume";
  agentId?: string | null;
}

interface LifecycleAckPayload {
  type: "lifecycle-ack";
  method: "pause" | "resume";
}

function isLifecycleAck(data: unknown): data is LifecycleAckPayload {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.type === "lifecycle-ack" &&
    (obj.method === "pause" || obj.method === "resume")
  );
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
 * subscribe to the theme via `plugin.theme.useTheme(...)`.
 *
 * Lifecycle: parents (typically the drone-switcher) call `pause()` /
 * `resume()` via a ref. The host posts a `lifecycle` event and waits
 * up to 300 ms for a matching `lifecycle-ack` before resolving. This
 * gives the plugin a chance to flush state to `ctx.config.set` or to
 * re-attach telemetry subscriptions for the new drone.
 */
export const PluginIframeHost = forwardRef<
  PluginIframeHostHandle,
  PluginIframeHostProps
>(function PluginIframeHost(
  {
    pluginId,
    slot,
    bundleUrl,
    grantedCapabilities,
    handlers,
    themeVars,
    title,
    className,
    onSecurityEvent,
    agentId,
    tokenValidator,
    token,
    hostEvent,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Refs hold the latest handler set + cap set + sink so the bridge
  // effect can stay attached across parent re-renders even when the
  // parent passes fresh object identities. Without this, every render
  // would dispose-and-recreate the bridge, dropping in-flight RPC.
  const handlersRef = useRef(handlers);
  const capsRef = useRef(grantedCapabilities);
  const sinkRef = useRef(onSecurityEvent);
  // The validator also lives behind a ref so token-refresh callbacks
  // and updated secret resolvers take effect without tearing down the
  // bridge. The bridge sees a stable wrapper that delegates to the
  // ref's `current` on every dispatch.
  const validatorRef = useRef<BridgeTokenValidatorOptions | undefined>(
    tokenValidator,
  );
  handlersRef.current = handlers;
  capsRef.current = grantedCapabilities;
  sinkRef.current = onSecurityEvent;
  validatorRef.current = tokenValidator;
  // Bridge effect keys only on whether a validator is configured. The
  // validator's internals (resolver function identity, onTokenExpired
  // closure) can change every render without forcing a rebuild because
  // the wrapper below reads them through `validatorRef.current`.
  const validatorEnabled = tokenValidator !== undefined;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const proxyHandlers: Record<string, BridgeHandler> = new Proxy(
      {},
      {
        get(_t, key: string) {
          return handlersRef.current[key];
        },
        has(_t, key: string) {
          return key in handlersRef.current;
        },
        ownKeys() {
          return Reflect.ownKeys(handlersRef.current);
        },
        getOwnPropertyDescriptor(_t, key: string) {
          return Object.getOwnPropertyDescriptor(handlersRef.current, key);
        },
      },
    ) as Record<string, BridgeHandler>;
    // Stable wrapper whose fields delegate to `validatorRef.current`.
    // The bridge captures this object once on construction; the inner
    // closures pull fresh state on every RPC so token refresh and key
    // rotation flow through without re-mounting the bridge.
    const validatorForBridge: BridgeTokenValidatorOptions | undefined =
      validatorEnabled
        ? {
            get expectedAgentId() {
              return validatorRef.current?.expectedAgentId ?? "";
            },
            secretResolver: (kind, subject) => {
              const v = validatorRef.current;
              if (!v) {
                return Promise.reject(
                  new Error("token validator detached during dispatch"),
                );
              }
              return v.secretResolver(kind, subject);
            },
            now: () => {
              const fn = validatorRef.current?.now;
              return fn ? fn() : Date.now();
            },
            onTokenExpired: () => validatorRef.current?.onTokenExpired?.(),
            get allowMissingToken() {
              return validatorRef.current?.allowMissingToken;
            },
          }
        : undefined;
    const bridge = createPluginBridge({
      pluginId,
      // The live getter form lets grant/revoke take effect without
      // re-mounting the bridge.
      grantedCapabilities: () => capsRef.current,
      iframe,
      handlers: proxyHandlers,
      onSecurityEvent: (event) => sinkRef.current?.(event),
      tokenValidator: validatorForBridge,
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

  /**
   * Post a lifecycle event and resolve when the iframe ACKs or after
   * the grace window. In demo mode there is no real plugin to talk to,
   * so we short-circuit and resolve on the next microtask.
   */
  const postLifecycle = useCallback(
    async (payload: LifecyclePayload): Promise<void> => {
      if (isDemoMode()) return;
      const iframe = iframeRef.current;
      const target = iframe?.contentWindow;
      if (!iframe || !target) return;

      return new Promise<void>((resolve) => {
        let settled = false;
        const finalize = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          clearTimeout(timer);
          resolve();
        };
        const onMessage = (ev: MessageEvent) => {
          if (ev.source !== target) return;
          if (!isLifecycleAck(ev.data)) return;
          if (ev.data.method !== payload.method) return;
          finalize();
        };
        window.addEventListener("message", onMessage);
        const timer = window.setTimeout(finalize, LIFECYCLE_ACK_TIMEOUT_MS);
        target.postMessage(payload, "*");
      });
    },
    [],
  );

  useImperativeHandle(
    ref,
    (): PluginIframeHostHandle => ({
      pause: () => postLifecycle({ type: "lifecycle", method: "pause" }),
      resume: (opts) =>
        postLifecycle({
          type: "lifecycle",
          method: "resume",
          agentId: opts?.agentId ?? agentId ?? null,
        }),
      getIframe: () => iframeRef.current,
    }),
    [postLifecycle, agentId],
  );

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
});
