/**
 * PostMessage bridge between the host React tree and a sandboxed
 * plugin iframe. This is the trust boundary.
 *
 * Validation pipeline (see spec 07-gcs-extensions section 5.2):
 *   1. Origin check  - source must equal the iframe contentWindow.
 *   2. Schema check  - envelope shape, version, types.
 *   3. Method check  - method must be in the known method registry.
 *   4. Capability    - resolved capability must be in the granted set.
 *   5. Dispatch      - registered handler runs, response posted back.
 *
 * The bridge itself does not call any agent or Convex functions; the
 * caller wires handlers per method. Keeping the bridge handler-agnostic
 * makes it trivial to test.
 */

import {
  TokenInvalid,
  verifyToken,
  type SecretResolver,
  type TokenClaims,
} from "./capability-token-claims";
import { resolveRequiredCapability, isKnownMethod } from "./methods";
import type { PluginRpcEnvelope } from "./types";

export type BridgeHandler = (
  args: unknown,
  ctx: BridgeHandlerContext,
) => Promise<unknown> | unknown;

export interface BridgeHandlerContext {
  pluginId: string;
  capability: string | null;
  postEvent: (method: string, capability: string, args: unknown) => void;
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
   * responsible for refreshing its token cache.
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

interface PostFn {
  (env: PluginRpcEnvelope): void;
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
  const {
    pluginId,
    grantedCapabilities,
    iframe,
    handlers,
    onSecurityEvent,
    tokenValidator,
  } = opts;
  const readGranted = (): ReadonlySet<string> =>
    typeof grantedCapabilities === "function"
      ? grantedCapabilities()
      : grantedCapabilities;

  const post: PostFn = (env) => {
    iframe.contentWindow?.postMessage(env, "*");
  };

  const pushEvent = (method: string, capability: string, args: unknown) => {
    post({
      id: cryptoRandomId(),
      type: "event",
      method,
      capability,
      args,
      version: 1,
    });
  };

  const respond = (
    requestId: string,
    method: string,
    capability: string,
    body: { result?: unknown; error?: BridgeError },
  ) => {
    post({
      id: requestId,
      type: "response",
      method,
      capability,
      args: body.result ?? null,
      version: 1,
      error: body.error
        ? { code: body.error.code, message: body.error.message }
        : undefined,
    });
  };

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
    if (!validateEnvelope(env)) {
      onSecurityEvent?.({
        code: "schema_invalid",
        message: "envelope failed schema validation",
      });
      return;
    }
    if (env.type !== "request") {
      // Plugin-originated events are not routed; only requests reach
      // host handlers. Future: route plugin-private events to bus.
      return;
    }
    if (!isKnownMethod(env.method)) {
      onSecurityEvent?.({
        code: "method_unknown",
        message: `unknown method ${env.method}`,
        method: env.method,
      });
      respond(env.id, env.method, env.capability, {
        error: { code: "method_unknown", message: `unknown method ${env.method}` },
      });
      return;
    }

    let claims: TokenClaims | null = null;
    if (tokenValidator) {
      const tokenResult = await validateToken(env, pluginId, tokenValidator);
      if (tokenResult.kind === "error") {
        onSecurityEvent?.({
          code: "capability_denied",
          message: tokenResult.message,
          method: env.method,
        });
        respond(env.id, env.method, env.capability, {
          error: {
            code: "capability_denied",
            message: `capability_denied:${tokenResult.reason}`,
          },
        });
        return;
      }
      claims = tokenResult.claims;
    }

    const required = resolveRequiredCapability(env.method, env.args);
    if (required === undefined) {
      onSecurityEvent?.({
        code: "schema_invalid",
        message: `bad args for ${env.method}`,
        method: env.method,
      });
      respond(env.id, env.method, env.capability, {
        error: { code: "schema_invalid", message: `bad args for ${env.method}` },
      });
      return;
    }

    if (required !== null) {
      const granted = readGranted();
      const claimSet = claims
        ? new Set<string>(claims.grantedCapabilities)
        : null;
      const inGranted = granted.has(required);
      // When a token is present, the token's `grantedCapabilities` claim
      // is the authoritative set (cloud-minted with operator approval).
      // The legacy in-memory `granted` set must also include the
      // capability so revocations applied to the GCS store take effect
      // before a fresh token is minted.
      const inClaim = claimSet === null ? true : claimSet.has(required);
      if (!inGranted || !inClaim) {
        const code: BridgeError["code"] =
          claimSet !== null && !inClaim
            ? "capability_denied"
            : "permission_denied";
        onSecurityEvent?.({
          code,
          message: `plugin lacks capability ${required}`,
          method: env.method,
        });
        respond(env.id, env.method, env.capability, {
          error: {
            code,
            message:
              code === "capability_denied"
                ? `capability_denied:${required}`
                : `plugin lacks capability ${required}`,
          },
        });
        return;
      }
    }

    const handler = handlers[env.method];
    if (!handler) {
      onSecurityEvent?.({
        code: "handler_unset",
        message: `no handler registered for ${env.method}`,
        method: env.method,
      });
      respond(env.id, env.method, env.capability, {
        error: {
          code: "handler_unset",
          message: `no handler registered for ${env.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(env.args, {
        pluginId,
        capability: required,
        postEvent: pushEvent,
        claims,
      });
      respond(env.id, env.method, env.capability, { result });
    } catch (err) {
      onSecurityEvent?.({
        code: "handler_error",
        message: errorMessage(err),
        method: env.method,
      });
      respond(env.id, env.method, env.capability, {
        error: { code: "handler_error", message: errorMessage(err) },
      });
    }
  };

  const onMessage = (ev: MessageEvent): void => {
    void handleEnvelope(ev.data as PluginRpcEnvelope, ev.source as WindowProxy);
  };

  window.addEventListener("message", onMessage);
  return {
    dispose: () => window.removeEventListener("message", onMessage),
    pushEvent,
    handleEnvelope,
  };
}

// ──────────────────────────────────────────────────────────────
// Validation helpers
// ──────────────────────────────────────────────────────────────

export function validateEnvelope(value: unknown): value is PluginRpcEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (v.type !== "request" && v.type !== "response" && v.type !== "event") {
    return false;
  }
  if (typeof v.method !== "string" || v.method.length === 0) return false;
  if (typeof v.capability !== "string") return false;
  return true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ValidateTokenResult =
  | { kind: "ok"; claims: TokenClaims }
  | {
      kind: "error";
      reason:
        | "token_missing"
        | "token_expired"
        | "plugin_mismatch"
        | "agent_mismatch"
        | "signature_invalid"
        | "token_invalid";
      message: string;
    };

/**
 * Run the 5-check token validation pipeline (see spec
 * 04-permission-model.md Section 11):
 *
 *   1. Token present.
 *   2. `expiresAt > now`.
 *   3. `pluginId === expectedPluginId`.
 *   4. `agentId === currentDeviceId` (unless `iss=local`; enforced by
 *      `verifyToken` itself).
 *   5. Signature verifies against the right issuer secret.
 *
 * Check 4 of the spec ("grantedCapabilities ⊇ required capability") is
 * enforced after this helper returns, because it depends on the resolved
 * capability for the method.
 */
async function validateToken(
  env: PluginRpcEnvelope,
  expectedPluginId: string,
  v: BridgeTokenValidatorOptions,
): Promise<ValidateTokenResult> {
  const now = v.now ?? Date.now;
  if (!env.token) {
    return {
      kind: "error",
      reason: "token_missing",
      message: "envelope missing capability token",
    };
  }
  try {
    const claims = await verifyToken(
      env.token,
      { pluginId: expectedPluginId, agentId: v.expectedAgentId },
      v.secretResolver,
    );
    // verifyToken already checks expiry, but we re-check via the
    // injected clock so unit tests can fast-forward without poking
    // crypto. This is also where we fire `onTokenExpired` for the SDK.
    if (claims.expiresAt <= now()) {
      v.onTokenExpired?.();
      return {
        kind: "error",
        reason: "token_expired",
        message: "token expired between fetch and dispatch",
      };
    }
    return { kind: "ok", claims };
  } catch (err) {
    if (err instanceof TokenInvalid) {
      const msg = err.message;
      // Map TokenInvalid sub-messages to the wire reason. `verifyToken`
      // throws with stable prefixes we pattern-match on.
      if (msg === "token expired") {
        v.onTokenExpired?.();
        return { kind: "error", reason: "token_expired", message: msg };
      }
      if (msg.startsWith("pluginId claim")) {
        return { kind: "error", reason: "plugin_mismatch", message: msg };
      }
      if (msg.startsWith("agentId claim")) {
        return { kind: "error", reason: "agent_mismatch", message: msg };
      }
      if (msg.endsWith("signature mismatch")) {
        return { kind: "error", reason: "signature_invalid", message: msg };
      }
      return { kind: "error", reason: "token_invalid", message: msg };
    }
    return {
      kind: "error",
      reason: "token_invalid",
      message: errorMessage(err),
    };
  }
}

function cryptoRandomId(): string {
  // 16 hex chars is plenty to correlate one envelope; collisions
  // would only mismatch a request and response on the same wire,
  // both of which are unique to this iframe.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}
