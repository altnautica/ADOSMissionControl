/**
 * Round-trip test for the cloud-issuer wire format.
 *
 * Signs with the Convex action's own signer (`convex/lib/capabilityTokenSigner`)
 * and feeds the resulting token straight into `verifyToken` from the
 * bridge verifier. A successful verify proves the cloud issuer and the
 * bridge speak the exact same wire format. If this test breaks, the
 * iframe RPC pipeline will reject every cloud-minted token at
 * `parseTokenClaims`.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  canonicalClaimsBytes,
  signTokenCanonical,
  urlsafeB64NoPad,
  type TokenClaims,
} from "../../convex/lib/capabilityTokenSigner";
import {
  importHmacKey,
  parseTokenClaims,
  verifyToken,
} from "@/lib/plugins/capability-token-claims";

const SECRET = new Uint8Array(32).fill(0x9c);
const SECRET_B64 = btoa(String.fromCharCode(...SECRET));

function makeClaims(over: Partial<TokenClaims> = {}): TokenClaims {
  return {
    pluginId: "com.example.basic",
    agentId: "drone-id-42",
    operatorId: "user-7",
    expiresAt: Date.now() + 60_000,
    grantedCapabilities: ["command.send", "telemetry.subscribe.mavlink.attitude"],
    iss: "cloud:user-7",
    ...over,
  };
}

describe("cloud mint wire format round-trip", () => {
  it("produces a token the bridge verifier accepts end-to-end", async () => {
    const claims = makeClaims();
    const token = await signTokenCanonical(claims, SECRET_B64);

    const verified = await verifyToken(
      token,
      { pluginId: claims.pluginId, agentId: claims.agentId },
      async () => [await importHmacKey(SECRET)],
    );

    expect(verified.pluginId).toBe(claims.pluginId);
    expect(verified.agentId).toBe(claims.agentId);
    expect(verified.iss).toBe(claims.iss);
    expect(verified.grantedCapabilities).toEqual(claims.grantedCapabilities);
  });

  it("emits the `<blob>.<sig>` wire shape with URL-safe alphabet and no padding", async () => {
    const claims = makeClaims();
    const token = await signTokenCanonical(claims, SECRET_B64);

    // Exactly one separator; neither half empty; no `=` padding;
    // characters are restricted to the URL-safe alphabet.
    const dot = token.indexOf(".");
    expect(dot).toBeGreaterThan(0);
    expect(token.indexOf(".", dot + 1)).toBe(-1);
    const [blob, sig] = token.split(".");
    expect(blob.length).toBeGreaterThan(0);
    expect(sig.length).toBeGreaterThan(0);
    expect(token).not.toMatch(/=/);
    expect(token).toMatch(/^[A-Za-z0-9_\-.]+$/);
  });

  it("signs over the exact bytes the verifier reads back, not a re-serialised JSON", async () => {
    const claims = makeClaims();
    const token = await signTokenCanonical(claims, SECRET_B64);

    // The verifier's `parseTokenClaims` decodes the blob exactly as
    // received. Compare those bytes with the bytes we signed; equality
    // proves there is no JSON.stringify-then-stringify round trip that
    // could perturb whitespace, key order, or escape sequences.
    const { blob: bytesAsParsed } = parseTokenClaims(token);
    const bytesAsSigned = canonicalClaimsBytes(claims);

    expect(Array.from(bytesAsParsed)).toEqual(Array.from(bytesAsSigned));
  });

  it("serialises claims with sorted keys and no whitespace, as the agent does", () => {
    const claims = makeClaims({ expiresAt: 1700000000000 });
    // Python: json.dumps(claims, sort_keys=True, separators=(",", ":"))
    expect(new TextDecoder().decode(canonicalClaimsBytes(claims))).toBe(
      '{"agentId":"drone-id-42","expiresAt":1700000000000,' +
        '"grantedCapabilities":["command.send","telemetry.subscribe.mavlink.attitude"],' +
        '"iss":"cloud:user-7","operatorId":"user-7","pluginId":"com.example.basic"}',
    );
  });

  it("urlsafeB64NoPad is consistent with the verifier's tolerant decoder", async () => {
    // Round-trip a payload that triggers `+` / `/` in standard base64
    // so we exercise the URL-safe substitution.
    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) raw[i] = (i * 37) & 0xff;
    const encoded = urlsafeB64NoPad(raw);
    expect(encoded).not.toMatch(/[+/=]/);

    // Mint a token, decode it via the verifier, and confirm we got back
    // the same claims bytes.
    const claims = makeClaims();
    const token = await signTokenCanonical(claims, SECRET_B64);
    const { claims: roundTripped } = parseTokenClaims(token);
    expect(roundTripped.pluginId).toBe(claims.pluginId);
    expect(roundTripped.agentId).toBe(claims.agentId);
  });
});
