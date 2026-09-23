"use client";

/**
 * @module command/system/DashboardAccessPinCard
 * @description Per-node control for the DASHBOARD-ACCESS PIN. A paired node's own
 * web dashboard (`http://<node>:8080`) is unlocked from another device on the
 * network by a 4-digit PIN. Mission Control — which holds the node's API key —
 * shows whether a PIN is set and can set or clear it. Clearing removes the PIN
 * and signs out every browser currently unlocked on that node's dashboard (the
 * session tokens are keyed with a salt the clear rotates); the dashboard is
 * then open until a new PIN is set.
 *
 * Local-first: the control reaches the node over the LAN via the `/api/lan-pair`
 * proxy with the node's stored key. It renders only for a locally-paired node,
 * resolved from the node the page is rendered for (never the focused
 * connection, which lags the render on a node switch).
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Lock } from "lucide-react";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  clearDashboardPin,
  getDashboardPinStatus,
  setDashboardPin,
  type DashboardPinStatus,
} from "@/lib/agent/local-pair-client";

const PIN_LENGTH = 4;

export function DashboardAccessPinCard({ nodeDeviceId }: { nodeDeviceId: string | null }) {
  const node = useLocalNodesStore((s) =>
    nodeDeviceId ? (s.nodes.find((n) => n.deviceId === nodeDeviceId) ?? null) : null,
  );
  const { toast } = useToast();
  const host = node?.hostname ?? null;
  const apiKey = node?.apiKey ?? null;

  // The status read is tagged with the host it was issued for, so a late
  // response for a previously shown node never lands on this one. `failed`
  // keeps an unreadable status distinct from "no PIN".
  const [read, setRead] = useState<{
    host: string;
    status: DashboardPinStatus | null;
    failed: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const latestHost = useRef<string | null>(null);
  latestHost.current = host;

  const refresh = useCallback(async () => {
    if (!host || !apiKey) return;
    setLoading(true);
    let next: { status: DashboardPinStatus | null; failed: boolean };
    try {
      next = { status: await getDashboardPinStatus(host, apiKey), failed: false };
    } catch {
      next = { status: null, failed: true };
    }
    if (latestHost.current !== host) return;
    setRead({ host, ...next });
    setLoading(false);
  }, [host, apiKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // No local key path for this node: the PIN is managed on the device. Hide
  // the card rather than show a control that cannot reach the node.
  if (!node) return null;
  const current = read && read.host === host ? read : null;
  const status = current?.status ?? null;
  const failed = current?.failed === true;

  const onSet = async () => {
    if (pin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    try {
      await setDashboardPin(node.hostname, node.apiKey, pin);
      toast("Dashboard PIN set", "success");
      setPin("");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to set PIN", "error");
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearDashboardPin(node.hostname, node.apiKey);
      toast("Dashboard PIN cleared", "success");
      setConfirmingReset(false);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear PIN", "error");
    } finally {
      setBusy(false);
    }
  };

  const reachUrl = node.hostname; // already http://<host>:8080

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <KeyRound size={16} className="text-accent-primary" />
        <h2 className="text-lg font-medium text-text-primary">Dashboard access</h2>
        <div className="flex-1" />
        {loading && !current ? (
          <span className="text-xs text-text-tertiary">checking…</span>
        ) : failed ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary/40 px-2.5 py-1 text-xs font-medium text-text-secondary">
            Unknown
          </span>
        ) : status?.locked ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-warning/40 bg-status-warning/10 px-2.5 py-1 text-xs font-medium text-status-warning">
            <Lock size={12} /> Locked
          </span>
        ) : status?.pinSet ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-xs font-medium text-status-success">
            PIN set
          </span>
        ) : status ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary/40 px-2.5 py-1 text-xs font-medium text-text-secondary">
            No PIN
          </span>
        ) : null}
      </div>

      <p className="mb-4 text-sm text-text-secondary">
        Visitors to this node&apos;s web dashboard enter a 4-digit PIN to unlock it. Clearing the
        PIN signs out anyone currently connected and leaves the dashboard open until a new PIN is
        set.
      </p>

      {failed && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <span>Could not read the PIN status from this node.</span>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            Retry
          </Button>
        </div>
      )}

      {/* Reach URL */}
      <div className="mb-4 rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">Web dashboard</div>
        <a
          href={reachUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-sm text-accent-primary hover:underline"
        >
          {reachUrl}
          <ExternalLink size={12} />
        </a>
      </div>

      {status && !status.pinSet ? (
        // Trust-on-first-use: Mission Control can seed the initial PIN.
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs text-text-secondary">Set a 4-digit PIN</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              value={pin}
              placeholder="0000"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              className="h-9 w-full rounded border border-border-default bg-bg-tertiary px-2 text-center font-mono text-lg tracking-[0.4em] text-text-primary focus:border-accent-primary focus:outline-none"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onSet()}
            disabled={pin.length !== PIN_LENGTH || busy}
          >
            {busy ? "Setting…" : "Set PIN"}
          </Button>
        </div>
      ) : status?.pinSet ? (
        // A PIN exists: offer a reset behind an inline confirm (destructive).
        confirmingReset ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">
              Clear the PIN? Connected browsers will be signed out and the dashboard stays open
              until a new PIN is set.
            </span>
            <Button variant="danger" size="sm" onClick={() => void onReset()} disabled={busy}>
              {busy ? "Clearing…" : "Confirm clear"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingReset(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmingReset(true)}>
            Clear PIN
          </Button>
        )
      ) : null}
    </section>
  );
}
