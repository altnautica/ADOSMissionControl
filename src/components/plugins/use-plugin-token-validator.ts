"use client";

/**
 * @module use-plugin-token-validator
 * @description Builds a `BridgeTokenValidatorOptions` for one plugin
 * iframe, AND returns the minted token the iframe must stamp onto its
 * envelopes. The bridge runs the validator on every RPC envelope and
 * rejects any call whose token fails one of the 5 checks (presence,
 * expiry, plugin id, agent id, signature against the right issuer
 * secret).
 *
 * Composition:
 *
 *   1. `useCapabilityToken(installId, pluginId, deviceId, transport)` mints
 *      and refreshes the operator's token for this (plugin, drone) pair. The
 *      cloud mint keys on the install row id; the agent mint keys on the
 *      manifest plugin id.
 *      Both halves of the mint are returned: `validator` for the bridge
 *      and `token` for the caller to publish into the iframe. The two
 *      MUST come from one hook call — a second `useCapabilityToken` for
 *      the same pair would mint twice and could hand the iframe a token
 *      the validator is not expecting.
 *
 *      `onTokenExpired` is wired to `refresh()` so a verifier-side
 *      expiry immediately triggers a fresh mint, which re-renders and
 *      re-publishes through the same channel.
 *
 *   2. Operator HMAC verification key
 *      (`operatorHmacSecrets.getMyVerificationKey`) resolves the
 *      `cloud:<userId>` issuer family. The key is derived per
 *      (install, device) and rotates; the GCS sees current + previous so
 *      tokens minted just before a rotation still verify until they
 *      expire.
 *
 *   3. Per-pairing HMAC secret (`deriveAgentTokenSecret(pairingKey)`)
 *      resolves the `agent:<deviceId>` issuer family. HKDF-SHA256
 *      derivation mirrors the agent's `derive_agent_token_secret`, so
 *      a token signed by the agent verifies here without round-tripping
 *      the raw pairing key over the network. The pairing key comes from
 *      the local-nodes store when this node was paired on the LAN, and
 *      otherwise from an owner-gated per-device Convex read.
 *
 *   4. `local` issuer raises `TokenInvalid` so any production envelope
 *      claiming `iss: local` against the GCS bridge is rejected.
 *      Production tokens go through `cloud` or `agent`.
 *
 * The hook calls Convex `useAction` via `useCapabilityToken` and is
 * therefore only safe to invoke under a `<ConvexProvider>`. The
 * `<PluginSlot>` mount picks between this hook and a plain pass-through
 * based on `useConvexAvailable()` and the presence of a deviceId; this
 * file assumes both preconditions hold.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useRef } from "react";

import { useCapabilityToken } from "@/hooks/use-capability-token";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import type { BridgeTokenValidatorOptions } from "@/lib/plugins/bridge";
import {
  TokenInvalid,
  deriveAgentTokenSecret,
  importHmacKeyFromBase64,
  type IssuerKind,
} from "@/lib/plugins/capability-token-claims";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { api as convexApi } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface UsePluginTokenValidatorOptions {
  /** Cloud install row id (cloud mint + operator verification key). */
  pluginInstallId: string;
  /** Manifest (reverse-DNS) plugin id (agent mint). */
  pluginId: string;
  /** Bare agent device id this iframe is bound to (token `agentId`). The
   * caller gates on its presence before mounting this hook. */
  deviceId: string;
}

/**
 * What the caller needs to run a validated plugin iframe: the bridge's
 * verification options AND the token the iframe must stamp onto its
 * envelopes. Both come from a single mint.
 */
export interface PluginTokenValidator {
  validator: BridgeTokenValidatorOptions;
  /**
   * The minted capability token, or `null` while the first mint is in flight
   * or after a mint error. The caller publishes this into the iframe; the
   * bridge answers `capability_denied:token_missing` for any envelope that
   * arrives without it.
   */
  token: string | null;
}

/**
 * Build the validator for one (plugin install, deviceId) pair, and surface
 * the minted token alongside it. The caller passes `validator` and `token`
 * to `<PluginIframeHost>`; the host wires the first into the bridge dispatch
 * pipeline and posts the second into the iframe.
 */
export function usePluginTokenValidator(
  opts: UsePluginTokenValidatorOptions,
): PluginTokenValidator {
  const { pluginInstallId, pluginId, deviceId } = opts;

  // Transport picks between cloud-issuer and LAN-direct-issuer minting
  // for the current connection. The verifier accepts whichever issuer
  // is on the wire; transport here only influences where the FRESH
  // tokens come from. cloudMode flips on HTTPS or when the LAN URL is
  // unreachable, matching the install dialog's resolver logic.
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const transport: "cloud" | "lan" = cloudMode ? "cloud" : "lan";
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Operator HMAC verification key, scoped to this (install, device). The
  // query soft-fails to `undefined` when the operator is signed out and
  // returns `null` for an install they do not own; in either case the
  // cloud-issuer resolver below raises and the bridge maps the failure to
  // `signature_invalid` / `token_invalid` for the offending RPC.
  const hmac = useConvexSkipQuery(
    convexApi.operatorHmacSecrets.getMyVerificationKey,
    {
      args: {
        pluginInstallId: pluginInstallId as Id<"cmd_pluginInstalls">,
        deviceId,
      },
    },
  );

  // Pairing key for this deviceId, used as HKDF input material to derive the
  // per-pairing HMAC secret the agent signed with. A LAN pairing already put
  // it in the local-nodes store; otherwise read it per-device through the
  // owner-gated Convex query rather than mirroring it onto every fleet row.
  const localPairingKey = useLocalNodesStore(
    (s) => s.nodes.find((n) => n.deviceId === deviceId)?.apiKey ?? null,
  );
  const cloudPairingKey =
    useConvexSkipQuery(cmdDronesApi.getAgentKey, {
      args: { deviceId },
      enabled: isAuthenticated && !localPairingKey,
    })?.apiKey ?? null;
  const pairingKey = localPairingKey ?? cloudPairingKey;

  // One mint per (install, device): `token` goes to the iframe, `refresh`
  // arms the validator's expiry callback. Minting twice for the same pair
  // would let the published token and the verified token diverge.
  const capabilityToken = useCapabilityToken(
    pluginInstallId,
    pluginId,
    deviceId,
    transport,
  );
  const refresh = capabilityToken.refresh;

  // Stash latest secret material in refs so the resolver closure stays
  // pinned across renders (the bridge captures the validator object
  // once; we want fresh secrets read on every dispatch).
  const hmacRef = useRef(hmac);
  const pairingKeyRef = useRef(pairingKey);
  hmacRef.current = hmac;
  pairingKeyRef.current = pairingKey;

  // Per-validator key caches. Importing a CryptoKey is async and the
  // result is stable for the lifetime of the secret; cache by the
  // secret material to avoid re-importing on every RPC.
  const cloudKeyCache = useRef<Map<string, Promise<CryptoKey>>>(new Map());
  const agentKeyCache = useRef<Map<string, Promise<CryptoKey>>>(new Map());

  const secretResolver = useCallback(
    async (kind: IssuerKind, _subject: string): Promise<CryptoKey> => {
      if (kind === "local") {
        // Local dev tokens carry no agent-id binding; production
        // bridges that see `iss: local` should reject. The agent half
        // gates `local` behind a dev-mode env flag. Until the GCS gets
        // its own dev-mode secret store, refuse here so the offending
        // RPC fails closed.
        throw new TokenInvalid(
          "local-issuer tokens are not supported by the GCS bridge",
        );
      }
      if (kind === "cloud") {
        const current = hmacRef.current;
        if (!current?.secretBase64) {
          throw new TokenInvalid(
            "operator HMAC secret is not loaded; cannot verify cloud-issued token",
          );
        }
        const cached = cloudKeyCache.current.get(current.secretBase64);
        if (cached) return cached;
        const minted = importHmacKeyFromBase64(current.secretBase64);
        cloudKeyCache.current.set(current.secretBase64, minted);
        // Pre-cache the previous secret so rotation-overlap tokens
        // verify without an extra resolver round-trip.
        if (
          current.previousSecretBase64 &&
          !cloudKeyCache.current.has(current.previousSecretBase64)
        ) {
          cloudKeyCache.current.set(
            current.previousSecretBase64,
            importHmacKeyFromBase64(current.previousSecretBase64),
          );
        }
        return minted;
      }
      // kind === "agent"
      const pairing = pairingKeyRef.current;
      if (!pairing) {
        throw new TokenInvalid(
          "pairing key unavailable; cannot derive per-pairing HMAC secret",
        );
      }
      const cached = agentKeyCache.current.get(pairing);
      if (cached) return cached;
      const derived = deriveAgentTokenSecret(pairing);
      agentKeyCache.current.set(pairing, derived);
      return derived;
    },
    [],
  );

  const onTokenExpired = useCallback(() => {
    // Fire-and-forget. The hook surfaces the error if the mint fails;
    // the bridge has already responded `capability_denied:token_expired`
    // to the iframe, and the fresh token is re-published by the host on
    // the next render.
    void refresh().catch(() => {
      /* swallowed; surfaced via `useCapabilityToken` */
    });
  }, [refresh]);

  const validator = useMemo<BridgeTokenValidatorOptions>(
    () => ({
      expectedAgentId: deviceId,
      secretResolver,
      onTokenExpired,
    }),
    [deviceId, secretResolver, onTokenExpired],
  );

  return { validator, token: capabilityToken.token };
}
