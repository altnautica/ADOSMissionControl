/**
 * PostMessage bridge between the host React tree and a sandboxed
 * plugin iframe. This is the trust boundary.
 *
 * The bridge adds one check in front of the shared envelope dispatcher
 * (`./envelope-dispatcher`): the message source must equal the iframe's
 * contentWindow. Schema, method, token and capability checks and handler
 * dispatch are the dispatcher's, shared with the inline host.
 *
 * The bridge itself does not call any agent or Convex functions; the
 * caller wires handlers per method. Keeping the bridge handler-agnostic
 * makes it trivial to test.
 */

import type { SecretResolver, TokenClaims } from "./capability-token-claims";
import { createEnvelopeDispatcher } from "./envelope-dispatcher";
import type { PluginRpcEnvelope } from "./types";

export type BridgeHandler = (
  args: unknown,
  ctx: BridgeHandlerContext,
) => Promise<unknown> | unknown;

/**
 * One bridge, which is one mounted iframe. A plugin's handler set is shared by
 * every panel the plugin mounts, so a handler that holds per-iframe state
 * (subscriptions, marks) keys it on the mount and releases it when the mount
 * disposes.
 */
export interface BridgeMount {
  /** Unique per bridge instance. */
  readonly id: string;
  /** Run `cleanup` when this bridge disposes (its iframe unmounted). */
  onDispose(cleanup: () => void): void;
}

export interface BridgeHandlerContext {
  pluginId: string;
  capability: string | null;
  /** Push a host event to the iframe this call came from. */
  postEvent: (method: string, capability: string, args: unknown) => void;
  /** The bridge (iframe) this call came through. */
  mount: BridgeMount;
  /** Claims from the verified token, present when the bridge runs with
   * a token validator. `null` when the bridge is in legacy mode. */
  claims: TokenClaims | null;
}

export interface BridgeError {
  code:
    | "origin_mismatch"
    | "schema_invalid"
    | "method_unknown"
    | "permission_denied"
    | "capability_denied"
    | "handler_error"
    | "handler_unset";
  message: string;
}

/**
 * Configures token validation on the bridge. When present, every RPC
 * envelope must carry a `token` field; the validator runs after the
 * schema check and before the capability-set check.
 *
 * `expectedAgentId` is the `cmd_drones._id` for the currently-selected
 * drone — the bridge rejects tokens whose `agentId` claim does not match,
 * which prevents cross-drone postMessage forgery.
 *
 * `secretResolver` returns the imported HMAC key for the issuer family
 * (`cloud` / `agent` / `local`). The caller owns secret fetching and
 * caching; the bridge only verifies.
 */
export interface BridgeTokenValidatorOptions {
  expectedAgentId: string;
  secretResolver: SecretResolver;
  /** Optional clock injection point for tests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Called when the validator wants the iframe to re-mint and re-send.
   * The bridge does NOT auto-retry; it returns a `capability_denied`
   * with `reason: "token_expired"` and the iframe (via the SDK) is
   * responsible for refreshing its token cache. Fired once per expired
   * token value, not once per envelope carrying it, so a plugin polling
   * with a stale token starts one refresh, not one per call.
   */
  onTokenExpired?: () => void;
}

export interface BridgeOptions {
  pluginId: string;
  /**
   * Capability set the plugin currently holds.
   *
   * Pass either:
   *   - a `ReadonlySet<string>` (snapshot, captured at construction), or
   *   - a `() => ReadonlySet<string>` (re-read on every dispatch, so
   *     grant/revoke takes effect without re-mounting the bridge).
   *
   * The function form is preferred when the caller's capability set
   * is reactive (Convex query, Zustand selector, etc).
   */
  grantedCapabilities:
    | ReadonlySet<string>
    | (() => ReadonlySet<string>);
  /** The iframe element whose contentWindow we trust. */
  iframe: HTMLIFrameElement;
  /** Method handlers; missing handler returns handler_unset error. */
  handlers: Record<string, BridgeHandler>;
  /** Optional security event sink (denials, malformed messages, etc). */
  onSecurityEvent?: (event: BridgeError & { method?: string }) => void;
  /**
   * Optional token validator. When set, every RPC envelope must carry a
   * `token` field. Each token is
   * verified against expiry, plugin id, agent id, capability membership,
   * and the issuer's signature. Failures emit `capability_denied`.
   */
  tokenValidator?: BridgeTokenValidatorOptions;
}

/**
 * Construct a bridge bound to one iframe. Returns a cleanup function
 * that removes the listener.
 */
export function createPluginBridge(opts: BridgeOptions): {
  dispose: () => void;
  /** Push a host-originated event to the plugin (e.g. theme change). */
  pushEvent: (method: string, capability: string, args: unknown) => void;
  /** Synthetic dispatch for unit tests. */
  handleEnvelope: (env: PluginRpcEnvelope, source: WindowProxy | null) => Promise<void>;
} {
  const { iframe, onSecurityEvent } = opts;
  const dispatcher = createEnvelopeDispatcher({
    pluginId: opts.pluginId,
    grantedCapabilities: opts.grantedCapabilities,
    handlers: opts.handlers,
    tokenValidator: opts.tokenValidator,
    onSecurityEvent,
    post: (env) => {
      iframe.contentWindow?.postMessage(env, "*");
    },
  });

  const handleEnvelope = async (
    env: PluginRpcEnvelope,
    source: WindowProxy | null,
  ): Promise<void> => {
    if (source !== iframe.contentWindow) {
      onSecurityEvent?.({
        code: "origin_mismatch",
        message: "message source did not match iframe contentWindow",
      });
      return;
    }
    await dispatcher.dispatch(env);
  };

  const onMessage = (ev: MessageEvent): void => {
    void handleEnvelope(ev.data as PluginRpcEnvelope, ev.source as WindowProxy);
  };

  window.addEventListener("message", onMessage);
  return {
    dispose: () => {
      window.removeEventListener("message", onMessage);
      dispatcher.dispose();
    },
    pushEvent: dispatcher.pushEvent,
    handleEnvelope,
  };
}
