/**
 * Tamper-evidence for compliance records.
 *
 * `signRecord` produces a SHA-256 hash over the canonical form of a flight
 * record (volatile fields stripped, keys sorted) plus an optional pilot
 * signature image. The hash is stored on the record. Subsequent edits or
 * exports can call `verifyRecord` to confirm the record is unchanged.
 *
 * No PKI — this is non-repudiable in the bookkeeping sense, not the legal
 * sense. Pairs well with the per-org audit log (Phase 23) which captures
 * who did what when.
 *
 * @module compliance/sign
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "@/lib/types";

/** Fields excluded from the canonical form (they change after signing). */
const VOLATILE_KEYS: ReadonlyArray<keyof FlightRecord> = [
  "updatedAt",
  "pilotSignedAt",
  "pilotSignatureHash",
  "events",
  "flags",
  "health",
  "notes",
  "tags",
  "favorite",
  "customName",
];

/**
 * Canonicalize a record into a deterministic JSON string.
 *
 * Stripped fields: see {@link VOLATILE_KEYS}. Object keys are sorted so
 * `JSON.stringify` produces stable output regardless of insertion order.
 */
export function canonicalizeRecord(record: FlightRecord): string {
  const filtered: Record<string, unknown> = {};
  const indexed = record as unknown as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    if ((VOLATILE_KEYS as ReadonlyArray<string>).includes(key)) continue;
    filtered[key] = indexed[key];
  }
  return JSON.stringify(filtered);
}

/** Web-Crypto SHA-256 of an arbitrary UTF-8 string → hex digest. */
async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto SubtleCrypto unavailable in this runtime");
  }
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute the signature hash for a record + optional pilot signature image.
 *
 * @param signatureImageBase64 base64-encoded PNG of the pilot signature.
 *   Concatenated to the canonical form so re-signing with a different image
 *   produces a different digest.
 */
export async function computeRecordHash(
  record: FlightRecord,
  signatureImageBase64?: string,
): Promise<string> {
  const canonical = canonicalizeRecord(record);
  return await sha256Hex(canonical + "\n" + (signatureImageBase64 ?? ""));
}

/**
 * Returns a partial patch for {@link FlightRecord} that seals the record:
 * `pilotSignatureHash` + `pilotSignedAt`.
 */
export async function signRecord(
  record: FlightRecord,
  signatureImageBase64?: string,
): Promise<{ pilotSignatureHash: string; pilotSignedAt: number }> {
  const hash = await computeRecordHash(record, signatureImageBase64);
  return { pilotSignatureHash: hash, pilotSignedAt: Date.now() };
}

/**
 * Verify a previously sealed record. Returns true iff the recomputed hash
 * matches the one stored on the record.
 */
export async function verifyRecord(
  record: FlightRecord,
  signatureImageBase64?: string,
): Promise<boolean> {
  if (!record.pilotSignatureHash) return false;
  const fresh = await computeRecordHash(record, signatureImageBase64);
  return fresh === record.pilotSignatureHash;
}
