"use client";

/**
 * @module components/fc/security/SigningDebugSection
 * @description Diagnostics panel for a drone's signing state.
 *
 * Renders a collapsed disclosure with:
 *   - Last tx/rx signed-frame timestamps (relative).
 *   - Per-session signed-frame counters from the signing store.
 *   - FC-side counter snapshot from the agent.
 *   - A "Copy diagnostics" button that writes a JSON blob to the
 *     clipboard for support tickets.
 *
 * All fields are safe to share: no keyHex, only the keyId fingerprint.
 *
 * @license GPL-3.0-only
 */

import { ChevronDown, ChevronRight, ClipboardCopy, Bug } from "lucide-react";
import { useState } from "react";

import { useSigningStore } from "@/stores/signing-store";
import { getOrCreateDeviceId } from "@/lib/protocol/link-id-allocator";

interface Props {
  droneId: string;
}

export function SigningDebugSection({ droneId }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const state = useSigningStore((s) => s.drones[droneId]);

  async function handleCopy() {
    const snapshot = buildDiagnostics(droneId, state);
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail in some browser contexts; swallow.
    }
  }

  return (
    <details
      className="border-t border-border-default pt-3"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="list-none cursor-pointer flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <Bug size={12} aria-hidden="true" />
        <span className="font-medium">Debug</span>
      </summary>
      {open && (
        <div className="mt-3 space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-secondary">
            <dt className="text-text-tertiary">Key fingerprint</dt>
            <dd className="font-mono">{state?.keyId ?? "—"}</dd>
            <dt className="text-text-tertiary">Has browser key</dt>
            <dd>{state?.hasBrowserKey ? "yes" : "no"}</dd>
            <dt className="text-text-tertiary">FC require</dt>
            <dd>{String(state?.requireOnFc ?? "—")}</dd>
            <dt className="text-text-tertiary">TX signed</dt>
            <dd>{state?.txSignedCount ?? 0}</dd>
            <dt className="text-text-tertiary">RX signed (observed)</dt>
            <dd>{state?.rxSignedCount ?? 0}</dd>
            <dt className="text-text-tertiary">Last signed frame</dt>
            <dd>
              {state?.lastSignedFrameAt
                ? relativeTime(state.lastSignedFrameAt)
                : "never"}
            </dd>
            <dt className="text-text-tertiary">Agent tx_signed</dt>
            <dd>{state?.agentCounters?.tx_signed_count ?? "—"}</dd>
            <dt className="text-text-tertiary">Agent rx_signed</dt>
            <dd>{state?.agentCounters?.rx_signed_count ?? "—"}</dd>
          </dl>
          <button
            type="button"
            onClick={handleCopy}
            className="px-2.5 py-1 text-xs border border-border-default hover:bg-bg-tertiary inline-flex items-center gap-1.5"
          >
            <ClipboardCopy size={12} aria-hidden="true" />
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
        </div>
      )}
    </details>
  );
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 1000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

interface SigningStateSubset {
  keyId: string | null;
  enrolledAt: string | null;
  requireOnFc: boolean | null;
  hasBrowserKey: boolean;
  enrollmentState: string;
  txSignedCount: number;
  rxSignedCount: number;
  lastSignedFrameAt: number | null;
  agentCounters: { tx_signed_count: number; rx_signed_count: number; last_signed_rx_at: number | null } | null;
}

export function buildDiagnostics(
  droneId: string,
  state: SigningStateSubset | undefined,
): Record<string, unknown> {
  return {
    droneId,
    deviceFingerprint: shortFingerprint(getOrCreateDeviceId()),
    capturedAt: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    signing: {
      keyId: state?.keyId ?? null,
      hasBrowserKey: state?.hasBrowserKey ?? false,
      enrolledAt: state?.enrolledAt ?? null,
      enrollmentState: state?.enrollmentState ?? "unknown",
      requireOnFc: state?.requireOnFc ?? null,
      txSignedCount: state?.txSignedCount ?? 0,
      rxSignedCount: state?.rxSignedCount ?? 0,
      lastSignedFrameAt: state?.lastSignedFrameAt ?? null,
      agentCounters: state?.agentCounters ?? null,
    },
  };
}

function shortFingerprint(id: string): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761) | 0;
    h2 = Math.imul(h2 ^ c, 1597334677) | 0;
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0").slice(0, 4)
  );
}
