/**
 * Tests for the JSON-claim multi-issuer token verifier.
 *
 * We mint tokens in-test using Web Crypto + the same canonical-JSON
 * serialisation the agent uses (sorted keys, no whitespace, urlsafe
 * base64 without padding). This keeps tests independent from the agent
 * codebase while exercising the exact wire format.
 */

import { describe, it, expect } from "vitest";

import {
  TokenInvalid,
  classifyIssuer,
  deriveAgentTokenSecret,
  importHmacKey,
  parseTokenClaims,
  verifyToken,
  type TokenClaims,
} from "@/lib/plugins/capability-token-claims";

const HKDF_SALT_BYTES = new TextEncoder().encode(
  "ados/plugin-capability-token/v1",
);

function urlsafeB64NoPad(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalClaimsBlob(claims: TokenClaims): Uint8Array {
  // Python uses json.dumps(payload, sort_keys=True, separators=(",", ":")).
  // We replicate that here.
  const sortedKeys: (keyof TokenClaims)[] = [
    "agentId",
    "expiresAt",
    "grantedCapabilities",
    "iss",
    "operatorId",
    "pluginId",
  ];
  const obj: Record<string, unknown> = {};
  for (const k of sortedKeys) obj[k] = claims[k];
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function mintToken(
  claims: TokenClaims,
  secret: Uint8Array,
): Promise<string> {
  const blob = canonicalClaimsBlob(claims);
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, blob as BufferSource),
  );
  return `${urlsafeB64NoPad(blob)}.${urlsafeB64NoPad(sig)}`;
}

function makeClaims(over: Partial<TokenClaims>): TokenClaims {
  return {
    pluginId: "com.example.basic",
    agentId: "drone-id-1",
    operatorId: "user-1",
    expiresAt: Date.now() + 60_000,
    grantedCapabilities: ["telemetry.subscribe.mavlink.attitude"],
    iss: "agent:drone-id-1",
    ...over,
  };
}

describe("classifyIssuer", () => {
  it("splits cloud / agent / local issuers", () => {
    expect(classifyIssuer("cloud:user-1")).toEqual({
      kind: "cloud",
      subject: "user-1",
    });
    expect(classifyIssuer("agent:drone-1")).toEqual({
      kind: "agent",
      subject: "drone-1",
    });
    expect(classifyIssuer("local")).toEqual({ kind: "local", subject: "" });
  });
  it("rejects unknown issuer", () => {
    expect(() => classifyIssuer("nope")).toThrow(TokenInvalid);
  });
});

describe("parseTokenClaims", () => {
  it("decodes a well-formed token", async () => {
    const secret = new Uint8Array(32).fill(7);
    const claims = makeClaims({});
    const token = await mintToken(claims, secret);
    const parsed = parseTokenClaims(token).claims;
    expect(parsed.pluginId).toBe("com.example.basic");
    expect(parsed.iss).toBe("agent:drone-id-1");
    expect(parsed.grantedCapabilities).toEqual([
      "telemetry.subscribe.mavlink.attitude",
    ]);
  });
  it("rejects malformed tokens", () => {
    expect(() => parseTokenClaims("")).toThrow(TokenInvalid);
    expect(() => parseTokenClaims("no-dot-here")).toThrow(TokenInvalid);
    expect(() => parseTokenClaims(".")).toThrow(TokenInvalid);
    expect(() => parseTokenClaims("aaa.bbb")).toThrow(TokenInvalid);
  });
});

describe("verifyToken HMAC", () => {
  const secret = new Uint8Array(32).fill(0x42);
  const wrongSecret = new Uint8Array(32).fill(0x77);

  it("accepts a valid signature", async () => {
    const claims = makeClaims({});
    const token = await mintToken(claims, secret);
    const result = await verifyToken(
      token,
      { pluginId: claims.pluginId, agentId: claims.agentId },
      async () => [await importHmacKey(secret)],
    );
    expect(result.pluginId).toBe(claims.pluginId);
    expect(result.iss).toBe(claims.iss);
  });

  it("rejects a tampered signature", async () => {
    const claims = makeClaims({});
    const token = await mintToken(claims, secret);
    await expect(
      verifyToken(
        token,
        { pluginId: claims.pluginId, agentId: claims.agentId },
        async () => [await importHmacKey(wrongSecret)],
      ),
    ).rejects.toBeInstanceOf(TokenInvalid);
  });

  it("accepts a token signed with the previous key after a rotation", async () => {
    const claims = makeClaims({ iss: "cloud:user-1" });
    const token = await mintToken(claims, wrongSecret);
    const result = await verifyToken(
      token,
      { pluginId: claims.pluginId, agentId: claims.agentId },
      async () => [await importHmacKey(secret), await importHmacKey(wrongSecret)],
    );
    expect(result.pluginId).toBe(claims.pluginId);
  });

  it("rejects an expired token", async () => {
    const claims = makeClaims({ expiresAt: Date.now() - 1 });
    const token = await mintToken(claims, secret);
    await expect(
      verifyToken(
        token,
        { pluginId: claims.pluginId, agentId: claims.agentId },
        async () => [await importHmacKey(secret)],
      ),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a plugin id mismatch", async () => {
    const claims = makeClaims({});
    const token = await mintToken(claims, secret);
    await expect(
      verifyToken(
        token,
        { pluginId: "com.example.other", agentId: claims.agentId },
        async () => [await importHmacKey(secret)],
      ),
    ).rejects.toThrow(/pluginId/);
  });

  it("rejects an agent id mismatch when issuer is not local", async () => {
    const claims = makeClaims({ iss: "cloud:user-1" });
    const token = await mintToken(claims, secret);
    await expect(
      verifyToken(
        token,
        { pluginId: claims.pluginId, agentId: "wrong-drone" },
        async () => [await importHmacKey(secret)],
      ),
    ).rejects.toThrow(/agentId/);
  });

  it("skips agent id check when issuer is local", async () => {
    const claims = makeClaims({
      iss: "local",
      agentId: "anything",
    });
    const token = await mintToken(claims, secret);
    const result = await verifyToken(
      token,
      { pluginId: claims.pluginId, agentId: "different-drone" },
      async () => [await importHmacKey(secret)],
    );
    expect(result.iss).toBe("local");
  });
});

describe("deriveAgentTokenSecret", () => {
  it("derives a 32-byte HMAC key from the pairing key", async () => {
    const key = await deriveAgentTokenSecret("test-pairing-key");
    expect(key.algorithm.name).toBe("HMAC");
    expect(key.type).toBe("secret");
  });

  it("matches a hand-rolled HKDF derivation byte-for-byte", async () => {
    // We compare by signing the same blob with both keys; if the
    // secrets match, the HMAC outputs match.
    const pairingKey = new TextEncoder().encode("hello-world");
    const baseKey = await crypto.subtle.importKey(
      "raw",
      pairingKey as BufferSource,
      { name: "HKDF" },
      false,
      ["deriveBits"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: HKDF_SALT_BYTES as BufferSource,
          info: new Uint8Array(0) as BufferSource,
        },
        baseKey,
        256,
      ),
    );
    const derivedKey = await deriveAgentTokenSecret(pairingKey);
    const expectedKey = await importHmacKey(expected);

    const blob = new TextEncoder().encode("payload");
    const sigDerived = new Uint8Array(
      await crypto.subtle.sign("HMAC", derivedKey, blob as BufferSource),
    );
    const sigExpected = new Uint8Array(
      await crypto.subtle.sign("HMAC", expectedKey, blob as BufferSource),
    );
    expect(Array.from(sigDerived)).toEqual(Array.from(sigExpected));
  });

  it("rejects an empty pairing key", async () => {
    await expect(deriveAgentTokenSecret("")).rejects.toBeInstanceOf(TokenInvalid);
  });
});
