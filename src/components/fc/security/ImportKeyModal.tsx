"use client";

/**
 * @module components/fc/security/ImportKeyModal
 * @description Paste-a-64-char-hex flow for bringing an existing signing
 * key into this browser.
 *
 * Used in two scenarios:
 *   1. The flight controller already has a key enrolled (by another
 *      browser or by a factory-provisioning step) and this browser
 *      needs to start signing with the same key.
 *   2. Operator is restoring a signing key from a backup (clipboard
 *      paste after an ExportKeyModal rotation on another device).
 *
 * The key is imported as a non-extractable Web Crypto key and stored in
 * IndexedDB. No FC enrollment happens here because the key is assumed
 * to already be on the FC. The next signed command to the FC will either
 * succeed (confirming the paste was correct) or fail silently (FC was
 * on a different key, key_missing banner returns on drone select).
 *
 * This is the "bring your own key" path for an operator whose key already
 * lives on the FC from another browser.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X, KeyRound, AlertTriangle, Loader2, Check } from "lucide-react";

import { useConvex } from "convex/react";

import { importAndStore } from "@/lib/protocol/signing-keystore";
import { allocateLocalLinkId } from "@/lib/protocol/link-id-allocator";
import { useSigningStore } from "@/stores/signing-store";
import { useAuthStore } from "@/stores/auth-store";
import { emitSigningEvent } from "@/lib/api/signing-events";

interface Props {
  droneId: string;
  open: boolean;
  onClose: () => void;
}

type ImportState = "entry" | "importing" | "done" | "error";

const HEX_RE = /^[0-9a-fA-F]+$/;
const REQUIRED_LEN = 64;
// 3.0 bits/char rejects weak keys (all zeros at 0, 2-symbol alternating
// at 1, 4-symbol patterns at 2) while leaving headroom for real random
// SHA-256-style hex which lands at ~3.9 with natural variance rather
// than exactly 4.0.
const MIN_SHANNON_BITS_PER_CHAR = 3.0;

export function ImportKeyModal({ droneId, open, onClose }: Props) {
  const [hex, setHex] = useState("");
  const [state, setState] = useState<ImportState>("entry");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setBrowserKey = useSigningStore((s) => s.setBrowserKey);
  const convexClient = useConvex();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!open) return;
    setHex("");
    setState("entry");
    setErrorMsg("");
    setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  // Inline validation. Computed on every keystroke so the Import button
  // only lights up when the paste is actually viable.
  const validation = useMemo(() => validateHex(hex), [hex]);

  async function handleImport() {
    if (!validation.valid) return;
    setState("importing");
    setErrorMsg("");
    try {
      const rawBytes = hexToBytes(hex);
      const linkId = allocateLocalLinkId();
      const record = await importAndStore({
        droneId,
        userId: null,
        keyBytes: rawBytes,
        linkId,
      });
      setBrowserKey(droneId, {
        keyId: record.keyId,
        enrolledAt: record.enrolledAt,
        enrollmentState: "enrolled",
      });
      void emitSigningEvent(convexClient, isAuthenticated, {
        droneId,
        eventType: "import",
        keyIdNew: record.keyId,
      });
      setState("done");
      setTimeout(onClose, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="import-key-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => e.target === e.currentTarget && state !== "importing" && onClose()}
    >
      <div className="bg-bg-secondary border border-border-default max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-accent-primary" aria-hidden="true" />
            <h2 id="import-key-title" className="text-base font-semibold text-text-primary">
              Import signing key
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state === "importing"}
            aria-label="Close"
            className="text-text-tertiary hover:text-text-primary disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {state === "entry" && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Paste a 64-character hex MAVLink signing key. The key is assumed
              to already be enrolled on the flight controller. No enrollment
              happens here.
            </p>
            <label className="block text-sm text-text-secondary">
              <span className="block mb-1">Signing key (hex)</span>
              <textarea
                ref={inputRef}
                value={hex}
                onChange={(e) => setHex(e.target.value.trim())}
                className="w-full bg-bg-primary border border-border-default px-3 py-2 text-xs font-mono text-text-primary break-all min-h-[80px] resize-none"
                placeholder="64 lowercase hex chars"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
            </label>
            {hex.length > 0 && !validation.valid && (
              <p
                role="alert"
                className="flex items-start gap-2 text-xs text-status-error"
              >
                <AlertTriangle size={12} className="mt-0.5" aria-hidden="true" />
                <span>{validation.reason}</span>
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-text-tertiary hover:text-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!validation.valid}
                className="px-3 py-1.5 text-sm bg-accent-primary text-white disabled:opacity-40"
              >
                Import
              </button>
            </div>
          </div>
        )}

        {state === "importing" && (
          <div className="flex items-center gap-3 text-sm text-text-secondary py-4">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            <span>Importing key…</span>
          </div>
        )}

        {state === "done" && (
          <div className="flex items-center gap-2 text-sm text-status-success py-4">
            <Check size={16} aria-hidden="true" />
            <span>Key imported. Signed commands will use this key.</span>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3">
            <div
              role="alert"
              className="flex items-start gap-2 text-sm text-status-error border border-status-error/40 bg-status-error/5 p-3"
            >
              <AlertTriangle size={14} className="mt-0.5" aria-hidden="true" />
              <span>{errorMsg || "Import failed."}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setState("entry");
                  setErrorMsg("");
                }}
                className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-text-tertiary hover:text-text-secondary"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Validation helpers (exported for unit tests)
// ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a pasted hex string. Must be 64 lowercase or mixed-case hex
 * chars and must clear a Shannon-entropy floor so trivially-weak keys
 * (all zeros, repeating patterns) are rejected before they hit the FC.
 */
export function validateHex(hex: string): ValidationResult {
  if (hex.length === 0) {
    return { valid: false };
  }
  if (hex.length !== REQUIRED_LEN) {
    return {
      valid: false,
      reason: `Expected ${REQUIRED_LEN} hex chars, got ${hex.length}.`,
    };
  }
  if (!HEX_RE.test(hex)) {
    return { valid: false, reason: "Not a hex string." };
  }
  const entropy = shannonBitsPerChar(hex.toLowerCase());
  if (entropy < MIN_SHANNON_BITS_PER_CHAR) {
    return {
      valid: false,
      reason: `Key looks too weak (entropy ${entropy.toFixed(2)} bits/char, need ≥ ${MIN_SHANNON_BITS_PER_CHAR}). A real random key has ~4 bits of entropy per hex char.`,
    };
  }
  return { valid: true };
}

/** Shannon entropy in bits per char over the observed alphabet. */
export function shannonBitsPerChar(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Parse lowercase or mixed-case hex into a Uint8Array. Assumes pre-validated. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
