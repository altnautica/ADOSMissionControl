"use client";

/**
 * @module components/fc/security/ExportKeyModal
 * @description Rotate-and-reveal flow for exporting a signing key.
 *
 * "Exporting" means rotating to a fresh key, copying the new bytes to the
 * clipboard, and replacing the stored key with the new one. The stored key
 * is raw bytes in this browser's IndexedDB (MAVLink signing hashes the key
 * itself, so it cannot live in a non-extractable Web Crypto handle), and
 * script on the page can read it. Export still rotates so every copy that
 * leaves the browser is a new key with its own enrollment record, and the
 * previously deployed key stops working on the FC.
 *
 * Security posture vs a "reveal current key" UX:
 *   - Clipboard-only, never rendered on screen. Screen recordings,
 *     webcams, shoulder-surfing, screen-sharing, and accessibility tools
 *     cannot OCR the key.
 *   - Clipboard auto-cleared after 60 seconds.
 *   - Typed-phrase "EXPORT" confirm so a casual click cannot rotate a key.
 *   - Every export is a rotation, so every export is logged on the agent
 *     side (enroll-fc already logs the new key_id).
 *   - The new key is stored in this browser before the clipboard is touched.
 *     Once the FC may hold it, losing it here locks the operator out, so a
 *     clipboard failure keeps the key and offers the copy again.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { X, AlertTriangle, Check, Clipboard, Loader2 } from "lucide-react";

import { useConvex } from "convex/react";

import type { AgentClient } from "@/lib/agent/client";
import { useSigningStore } from "@/stores/signing-store";
import { useAuthStore } from "@/stores/auth-store";
import { emitSigningEvent } from "@/lib/api/signing-events";
import {
  getCloudKeyForDrone,
  uploadKey,
} from "@/lib/api/signing-cloud-sync";
import { enrollNewKey } from "./signing/enroll-key";

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
  | "copy_failed"  // new key stored, clipboard write refused; retry offered
  | "cleared"      // clipboard wiped, modal about to close
  | "error";

const CLIPBOARD_HOLD_MS = 60_000;

export function ExportKeyModal({ client, droneId, linkId, open, onClose }: Props) {
  const [state, setState] = useState<ExportState>("confirm");
  const [phrase, setPhrase] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CLIPBOARD_HOLD_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The one copy of the new key's hex this modal may still hand to the
  // clipboard. Dropped as soon as the copy succeeds or the modal closes.
  const pendingHexRef = useRef<string | null>(null);

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
      pendingHexRef.current = null;
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

  async function copyPendingKey() {
    const keyHex = pendingHexRef.current;
    if (keyHex === null) return;
    try {
      await navigator.clipboard.writeText(keyHex);
      pendingHexRef.current = null;
      setErrorMsg("");
      setState("copied");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("copy_failed");
    }
  }

  async function handleExport() {
    if (phrase !== "EXPORT") return;
    setState("rotating");
    setErrorMsg("");
    const userId = isAuthenticated ? (useAuthStore.getState().user?.id ?? null) : null;
    const outcome = await enrollNewKey({ client, droneId, linkId, userId });
    if (outcome.kind === "failed") {
      setErrorMsg(outcome.error);
      setState("error");
      return;
    }
    // The key is in the keystore now; mirror it before anything else can fail.
    setBrowserKey(droneId, {
      keyId: outcome.keyId,
      enrolledAt: outcome.enrolledAt,
      enrollmentState: outcome.kind === "enrolled" ? "enrolled" : "unconfirmed",
      previousKeyId: outcome.kind === "unconfirmed" ? outcome.previousKeyId : null,
    });
    // If this drone was opt-in for cloud sync, upload the new key now so the
    // cloud copy matches the FC. An unconfirmed key is not uploaded: other
    // browsers must not replace a key the FC may still hold.
    if (outcome.kind === "enrolled" && isAuthenticated && convexClient) {
      try {
        const existingRow = await getCloudKeyForDrone(convexClient, droneId);
        if (existingRow !== null) {
          await uploadKey(convexClient, {
            droneId,
            keyHex: outcome.keyHex,
            keyId: outcome.keyId,
            linkIdOwner: linkId,
            enrolledAt: outcome.enrolledAt,
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
      keyIdNew: outcome.keyId,
    });
    pendingHexRef.current = outcome.keyHex;
    await copyPendingKey();
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

        {state === "copy_failed" && (
          <div className="space-y-3">
            <div
              role="alert"
              className="flex items-start gap-2 text-sm text-status-warning border border-status-warning/40 bg-status-warning/5 p-3"
            >
              <AlertTriangle size={14} className="mt-0.5" aria-hidden="true" />
              <span>
                The new key is enrolled and stored in this browser, but the clipboard refused it
                ({errorMsg || "copy failed"}). Copy it again before closing: this dialog only exports by
                rotating, so exporting after it closes replaces the key again.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-text-tertiary hover:text-text-secondary"
              >
                Close without copying
              </button>
              <button
                type="button"
                onClick={() => void copyPendingKey()}
                className="px-3 py-1.5 text-sm bg-accent-primary text-white"
              >
                Copy again
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
