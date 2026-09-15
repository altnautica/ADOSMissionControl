/**
 * @module plugins/signing-keys
 * @description The enrolled `.adosplug` Ed25519 signing keys the GCS will
 * verify an archive against, and the explicit first-party allowlist.
 *
 * These are the same public keys the agent installs at
 * `/etc/ados/plugin-keys/<signer-id>.pem`, vendored here in SubjectPublicKeyInfo
 * (SPKI) base64 — the body of the PEM, unwrapped. Rotation is a deliberate code
 * change in both places, never a runtime knob: an operator who could add a key
 * at runtime could mint first-party trust.
 *
 * Two rules this module exists to enforce:
 *
 *   1. **Enrolment, not shape.** A signer id is trusted because its public key
 *      is in {@link ENROLLED_PLUGIN_SIGNER_KEYS}, not because the string looks
 *      like `altnautica-YYYY-X`. A regex over the id proves nothing about who
 *      produced the archive.
 *   2. **First-party is a subset, listed by hand.** {@link FIRST_PARTY_PLUGIN_SIGNERS}
 *      mirrors `FIRST_PARTY_SIGNERS` in the agent's `ados.plugins.signing`. A
 *      key can be enrolled (so its archives verify) without being first-party.
 *
 * @license GPL-3.0-only
 */

/**
 * One enrolled signing key: the SPKI base64 the browser imports, plus the
 * short fingerprint the `ados plugin keygen` CLI prints so an operator can
 * cross-check what the GCS trusts against what is on the agent.
 *
 * The fingerprint is `base64(sha256(raw 32-byte public key))` truncated to 22
 * characters, matching the agent's derivation exactly.
 */
export interface EnrolledSignerKey {
  /** SubjectPublicKeyInfo DER, base64 — the PEM body with the armour removed. */
  readonly spkiBase64: string;
  /** Operator-verifiable short fingerprint. */
  readonly fingerprint: string;
}

/**
 * Public keys the GCS accepts a plugin archive signature under, keyed by the
 * signer id written into the archive's `SIGNATURE` entry.
 *
 * Mirrors the PEM files under `ADOSDroneAgent/scripts/plugin-keys/`. Adding an
 * entry here without the matching PEM on the agent means an archive verifies in
 * the browser and is refused on the node; the two MUST stay in sync.
 */
export const ENROLLED_PLUGIN_SIGNER_KEYS: Readonly<
  Record<string, EnrolledSignerKey>
> = {
  "altnautica-2026-A": {
    spkiBase64: "MCowBQYDK2VwAyEAT3FZIbbHxS+KMnEJk9qQ9w814QFz7dqZBPCCHqo7gX4=",
    fingerprint: "zUQxuJTOkKcsFGqwUUquG7",
  },
  "altnautica-2026-B": {
    spkiBase64: "MCowBQYDK2VwAyEAvg+xckNXfFg3vyY/8CMEDoIFFjKWp3YNOJUUg6+PS3s=",
    fingerprint: "B+HGOrsJlGMErMThsba+LV",
  },
};

/**
 * Signer ids whose verified archives are first-party.
 *
 * Held as an explicit table rather than a pattern over the id so a third party
 * who enrols a key cannot reach first-party status by naming it
 * `altnautica-2099-Z`.
 */
export const FIRST_PARTY_PLUGIN_SIGNERS: Readonly<Record<string, true>> = {
  "altnautica-2026-A": true,
  "altnautica-2026-B": true,
};

/** Cache of imported verify keys, keyed by signer id. */
const keyCache = new Map<string, Promise<CryptoKey>>();

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Import the enrolled verify key for `signerId`, or resolve `null` when the
 * signer is not enrolled. Cached per signer id for the process lifetime; the
 * key material is compile-time constant.
 *
 * Throws only when the runtime has no Ed25519 in Web Crypto, which the caller
 * maps to a refusal (never to a pass).
 */
export async function importEnrolledSignerKey(
  signerId: string,
): Promise<CryptoKey | null> {
  const entry = ENROLLED_PLUGIN_SIGNER_KEYS[signerId];
  if (!entry) return null;
  const cached = keyCache.get(signerId);
  if (cached) return cached;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== "function") {
    throw new Error(
      "Web Crypto is unavailable; cannot verify a plugin archive signature",
    );
  }
  const der = base64ToBytes(entry.spkiBase64);
  const buf = new ArrayBuffer(der.byteLength);
  new Uint8Array(buf).set(der);
  const imported = subtle
    .importKey("spki", buf, { name: "Ed25519" }, false, ["verify"])
    .catch((err: unknown) => {
      keyCache.delete(signerId);
      throw err;
    });
  keyCache.set(signerId, imported);
  return imported;
}

/**
 * True when `signerId` is enrolled AND on the first-party allowlist.
 *
 * Says nothing about whether any particular archive verified — callers MUST
 * combine this with a `"verified"` signature state before showing first-party
 * trust.
 */
export function isEnrolledFirstPartySigner(
  signerId?: string | null,
): boolean {
  if (!signerId) return false;
  const id = signerId.trim();
  return (
    FIRST_PARTY_PLUGIN_SIGNERS[id] === true &&
    ENROLLED_PLUGIN_SIGNER_KEYS[id] !== undefined
  );
}
