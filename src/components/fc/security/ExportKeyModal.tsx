"use client";

/**
 * @module components/fc/security/ExportKeyModal
 * @description Rotate-and-reveal flow for exporting a signing key.
 *
 * The CryptoKey held in IndexedDB is non-extractable by design. We cannot
 * read its raw bytes back even from the same JavaScript context. The only
 * moment raw bytes exist in the browser is the split second between
 * generation and the non-extractable import. We reuse that window here:
 * "exporting" means rotating to a fresh key, copying the new bytes to
 * the clipboard, and replacing the stored key with the new one.
 *
 * Security posture vs a "reveal current key" UX:
 *   - Clipboard-only, never rendered on screen. Screen recordings,
 *     webcams, shoulder-surfing, screen-sharing, and accessibility tools
 *     cannot OCR the key.
 *   - Clipboard auto-cleared after 60 seconds.
 *   - Typed-phrase "EXPORT" confirm so a casual click cannot rotate a key.
 *   - Every export is a rotation, so every export is logged on the agent
 *     side (enroll-fc already logs the new key_id).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { X, AlertTriangle, Check, Clipboard, Loader2 } from "lucide-react";

import {
  generateRandomKey,
  keyBytesToHex,
  zeroize,
} from "@/lib/protocol/mavlink-signer";
import { useConvex } from "convex/react";

import { importAndStore } from "@/lib/protocol/signing-keystore";
import type { AgentClient } from "@/lib/agent/client";
import { useSigningStore } from "@/stores/signing-store";
import { useAuthStore } from "@/stores/auth-store";
import { emitSigningEvent } from "@/lib/api/signing-events";
import {
  getCloudKeyForDrone,
  uploadKey,
} from "@/lib/api/signing-cloud-sync";

interface Props {
  client: AgentClient;
  droneId: string;
  linkId: number;
  open: boolean;
  onClose: () => void;
}

type ExportState =
  | "confirm"      // user typing EXPORT
  | "rotating"     // generating + enrolling + storing new key
  | "copied"       // new key in clipboard, 60s countdown running
  | "cleared"      // clipboard wiped, modal about to close
  | "error";

const CLIPBOARD_HOLD_MS = 60_000;

export function ExportKeyModal({ client, droneId, linkId, open, onClose }: Props) {
  const [state, setState] = useState<ExportState>("confirm");
  const [phrase, setPhrase] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CLIPBOARD_HOLD_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setBrowserKey = useSigningStore((s) => s.setBrowserKey);
  const stateForAudit = useSigningStore((s) => s.drones[droneId]);
  const convexClient = useConvex();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Reset state when opened fresh.
  useEffect(() => {
    if (!open) return;
    setState("confirm");
    setPhrase("");
    setErrorMsg("");
    setSecondsLeft(CLIPBOARD_HOLD_MS / 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [open]);

  // Auto-close after the clipboard hold expires.
  useEffect(() => {
    if (state !== "copied") return;
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Last tick: wipe clipboard and close.
          clearClipboard();
          setState("cleared");
          setTimeout(onClose, 600);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [state, onClose]);

  async function handleExport() {
    if (phrase !== "EXPORT") return;
    setState("rotating");
    setErrorMsg("");
    const rawBytes = generateRandomKey();
    try {
      const keyHex = keyBytesToHex(rawBytes);
      const result = await client.enrollSigningKey(keyHex, linkId);
      // Copy to clipboard BEFORE import-as-non-extractable zeroizes the buffer.
      await navigator.clipboard.writeText(keyHex);
      const record = await importAndStore({
        droneId,
        userId: null,
        keyBytes: rawBytes,
        linkId,
      });
      setBrowserKey(droneId, {
        keyId: result.key_id,
        enrolledAt: result.enrolled_at,
        enrollmentState: "enrolled",
      });
      // If this drone was opt-in for cloud sync, upload the new key now
      // while keyHex is still in scope. The non-extractable CryptoKey we
      // just created cannot be exported again, so this is the one
      // window. Without this, cloud-synced browsers would pull the old
      // (now-dead) key from Convex on next refresh.
      if (isAuthenticated && convexClient) {
        try {
          const existingRow = await getCloudKeyForDrone(convexClient, droneId);
          if (existingRow !== null) {
            await uploadKey(convexClient, {
              droneId,
              keyHex,
              keyId: result.key_id,
              linkIdOwner: linkId,
              enrolledAt: result.enrolled_at,
            });
          }
        } catch {
          // Non-fatal. The local rotation already succeeded; cloud row
          // is stale until the next rotation retries.
        }
      }
      void emitSigningEvent(convexClient, isAuthenticated, {
        droneId,
        eventType: "export",
        keyIdOld: stateForAudit?.keyId ?? undefined,
        keyIdNew: result.key_id,
      });
      // Discard the variable that still referenced the hex string.
      // JS strings are immutable so we cannot zero them, but dropping
      // the reference lets GC reclaim the memory eventually.
      void record;
      setState("copied");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      zeroize(rawBytes);
      setState("error");
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="export-key-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => e.target === e.currentTarget && state !== "rotating" && onClose()}
    >
      <div className="bg-bg-secondary border border-border-default max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-status-warning" aria-hidden="true" />
            <h2 id="export-key-title" className="text-base font-semibold text-text-primary">
              Export signing key
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state === "rotating"}
            aria-label="Close"
            className="text-text-tertiary hover:text-text-primary disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {state === "confirm" && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Exporting rotates the key: a new 32-byte key is generated, enrolled with the flight
              controller, and copied to your clipboard. The old key stops working immediately.
            </p>
            <p className="text-sm text-text-secondary">
              The new key never appears on screen. Paste it into your destination within 60 seconds;
              after that the clipboard is cleared automatically.
            </p>
            <label className="block text-sm text-text-secondary">
              <span className="block mb-1">
                Type <span className="font-mono font-bold text-text-primary">EXPORT</span> to continue.
              </span>
              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                className="w-full bg-bg-primary border border-border-default px-3 py-1.5 text-sm font-mono text-text-primary"
                autoFocus
              />
            </label>
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
                onClick={handleExport}
                disabled={phrase !== "EXPORT"}
                className="px-3 py-1.5 text-sm bg-accent-primary text-white disabled:opacity-40"
              >
                Rotate and copy
              </button>
            </div>
          </div>
        )}

        {state === "rotating" && (
          <div className="flex items-center gap-3 text-sm text-text-secondary py-4">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            <span>Rotating key…</span>
          </div>
        )}

        {state === "copied" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-status-success">
              <Check size={16} className="mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Copied to clipboard</p>
                <p className="text-xs text-text-tertiary">
                  Paste into the other browser or backup store within {secondsLeft}s.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-text-tertiary">
                <Clipboard size={12} className="inline mr-1" aria-hidden="true" />
                clipboard auto-clears in {secondsLeft}s
              </span>
              <button
                type="button"
                onClick={() => {
                  clearClipboard();
                  setState("cleared");
                  setTimeout(onClose, 400);
                }}
                className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary"
              >
                Clear now
              </button>
            </div>
          </div>
        )}

        {state === "cleared" && (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-4">
            <Check size={16} className="text-status-success" aria-hidden="true" />
            <span>Clipboard cleared.</span>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3">
            <div
              role="alert"
              className="flex items-start gap-2 text-sm text-status-error border border-status-error/40 bg-status-error/5 p-3"
            >
              <AlertTriangle size={14} className="mt-0.5" aria-hidden="true" />
              <span>{errorMsg || "Export failed."}</span>
            </div>
            <div className="flex gap-2 justify-end">
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

function clearClipboard(): void {
  try {
    void navigator.clipboard.writeText("");
  } catch {
    // clipboard write can be blocked on some browsers; best-effort
  }
}
