/**
 * @module plugins/envelope-dispatcher
 * @description The transport-independent half of the plugin bridge: every
 * check a plugin RPC passes before a host handler runs, and the response and
 * event envelopes the host sends back. `createPluginBridge` wraps it for a
 * sandboxed iframe (postMessage, source check); the inline host wraps it with
 * an in-memory transport.
 *
 * Validation pipeline, in order:
 *   1. Schema check  - envelope shape, version, types.
 *   2. Method check  - method must be in the known method registry.
 *   3. Token check   - when a validator is configured.
 *   4. Capability    - resolved capability must be in the granted set (and in
 *                      the token's claim when a token is present).
 *   5. Dispatch      - registered handler runs, response posted back.
 *
 * @license GPL-3.0-only
 */

import {
  TokenInvalid,
  verifyToken,
  type TokenClaims,
} from "./capability-token-claims";
import { resolveRequiredCapability, isKnownMethod } from "./methods";
import type { PluginRpcEnvelope } from "./types";
import type {
  BridgeError,
  BridgeHandler,
  BridgeMount,
  BridgeTokenValidatorOptions,
} from "./bridge";

export interface EnvelopeDispatcherOptions {
  pluginId: string;
  /**
   * Capability set the plugin currently holds: a snapshot, or a getter
   * re-read on every dispatch so grant/revoke applies without a remount.
   */
  grantedCapabilities: ReadonlySet<string> | (() => ReadonlySet<string>);
  /** Method handlers; a missing handler answers handler_unset. */
  handlers: Record<string, BridgeHandler>;
  /** Optional token validator; every envelope must then carry a token. */
  tokenValidator?: BridgeTokenValidatorOptions;
  /** Optional security event sink (denials, malformed messages, etc). */
  onSecurityEvent?: (event: BridgeError & { method?: string }) => void;
  /** Deliver one host envelope (a response or an event) to the plugin. */
  post: (env: PluginRpcEnvelope) => void;
}

export interface EnvelopeDispatcher {
  /** Validate and dispatch one plugin-originated envelope. Never throws. */
  dispatch: (env: unknown) => Promise<void>;
  /** Push a host-originated event to the plugin (e.g. theme change). */
  pushEvent: (method: string, capability: string, args: unknown) => void;
  /** Run every mount cleanup a handler registered. */
  dispose: () => void;
}

export function createEnvelopeDispatcher(
  opts: EnvelopeDispatcherOptions,
): EnvelopeDispatcher {
  const { pluginId, grantedCapabilities, handlers, onSecurityEvent, tokenValidator, post } =
    opts;
  const readGranted = (): ReadonlySet<string> =>
    typeof grantedCapabilities === "function"
      ? grantedCapabilities()
      : grantedCapabilities;

  // The last token reported expired: envelopes that keep carrying it do not
  // fire `onTokenExpired` again.
  let lastExpiredToken: string | null = null;
  const tokenExpired = (token: string) => {
    if (token === lastExpiredToken) return;
    lastExpiredToken = token;
    tokenValidator?.onTokenExpired?.();
  };

  const cleanups: Array<() => void> = [];
  const mount: BridgeMount = {
    id: cryptoRandomId(),
    onDispose: (cleanup) => {
      cleanups.push(cleanup);
    },
  };

  const pushEvent = (method: string, capability: string, args: unknown) => {
    post({ id: cryptoRandomId(), type: "event", method, capability, args, version: 1 });
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

  const deny = (env: PluginRpcEnvelope, error: BridgeError) => {
    onSecurityEvent?.({ ...error, method: env.method });
    respond(env.id, env.method, env.capability, { error });
  };

  const dispatchEnvelope = async (env: unknown): Promise<void> => {
    if (!validateEnvelope(env)) {
      onSecurityEvent?.({
        code: "schema_invalid",
        message: "envelope failed schema validation",
      });
      return;
    }
    // Plugin-originated events are not routed; only requests reach handlers.
    if (env.type !== "request") return;
    if (!isKnownMethod(env.method)) {
      deny(env, { code: "method_unknown", message: `unknown method ${env.method}` });
      return;
    }

    let claims: TokenClaims | null = null;
    if (tokenValidator) {
      const tokenResult = await validateToken(env, pluginId, tokenValidator, tokenExpired);
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
      deny(env, { code: "schema_invalid", message: `bad args for ${env.method}` });
      return;
    }

    if (required !== null) {
      const claimSet = claims ? new Set<string>(claims.grantedCapabilities) : null;
      const inGranted = readGranted().has(required);
      // With a token, its cloud-minted claim is authoritative; the in-memory
      // granted set must also hold the capability so a revoke applied to the
      // GCS store takes effect before a fresh token is minted.
      const inClaim = claimSet === null ? true : claimSet.has(required);
      if (!inGranted || !inClaim) {
        const code: BridgeError["code"] =
          claimSet !== null && !inClaim ? "capability_denied" : "permission_denied";
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

    // Own-property lookup only: an inherited name such as `constructor` must
    // never resolve to an Object.prototype member.
    const handler = Object.hasOwn(handlers, env.method) ? handlers[env.method] : undefined;
    if (!handler) {
      deny(env, {
        code: "handler_unset",
        message: `no handler registered for ${env.method}`,
      });
      return;
    }

    try {
      const result = await handler(env.args, {
        pluginId,
        capability: required,
        postEvent: pushEvent,
        mount,
        claims,
      });
      respond(env.id, env.method, env.capability, { result });
    } catch (err) {
      deny(env, { code: "handler_error", message: errorMessage(err) });
    }
  };

  // Any throw in the pipeline (a malformed `args`, a resolver bug) is answered
  // with schema_invalid so the plugin's call settles instead of timing out.
  const dispatch = async (env: unknown): Promise<void> => {
    try {
      await dispatchEnvelope(env);
    } catch (err) {
      // Never answer an envelope that could not be addressed.
      if (!validateEnvelope(env)) return;
      const message = `rejected ${env.method}: ${errorMessage(err)}`;
      deny(env, { code: "schema_invalid", message });
    }
  };

  return {
    dispatch,
    pushEvent,
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // One failing teardown must not keep the others from running.
        }
      }
    },
  };
}

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
 * Run the token validation pipeline:
 *
 *   1. Token present.
 *   2. `expiresAt > now`.
 *   3. `pluginId === expectedPluginId`.
 *   4. `agentId === currentDeviceId` (unless `iss=local`; enforced by
 *      `verifyToken` itself).
 *   5. Signature verifies against the right issuer secret.
 *
 * The capability-membership check runs after this helper returns, because it
 * depends on the resolved capability for the method.
 */
async function validateToken(
  env: PluginRpcEnvelope,
  expectedPluginId: string,
  v: BridgeTokenValidatorOptions,
  tokenExpired: (token: string) => void,
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
    // verifyToken already checks expiry; the injected clock re-check lets unit
    // tests fast-forward without poking crypto, and fires `onTokenExpired`.
    if (claims.expiresAt <= now()) {
      tokenExpired(env.token);
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
      // `verifyToken` throws with stable prefixes mapped to the wire reason.
      if (msg === "token expired") {
        tokenExpired(env.token);
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
    return { kind: "error", reason: "token_invalid", message: errorMessage(err) };
  }
}

function cryptoRandomId(): string {
  // 16 hex chars is plenty to correlate one envelope on one channel.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}
