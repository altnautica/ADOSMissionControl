"use client";

/**
 * @module NodeReachBlock
 * @description The address a node is actually reached at, and what happened
 * the last time the GCS tried.
 *
 * A locally-paired node carries up to three candidate reaches (the base URL
 * the operator typed, the mDNS name the agent reports, the proxy-resolved
 * IPv4) and different consumers pick different ones. Until this block existed
 * no surface named any of them after the pair card closed, so when a node
 * greyed out the operator could not tell whether the agent was down, the
 * `.local` name had stopped resolving, or the DHCP lease had moved — three
 * causes, one identical grey tile.
 *
 * Honesty rules this component holds to:
 *   - It reports only what the transport proved. It never says "the name did
 *     not resolve", because through the server-side proxy a DNS failure and a
 *     dead board are the same 502 (see `lib/nodes/reach-provenance`).
 *   - A failure keeps naming the address that last WORKED, because that is the
 *     fact the operator needs to act.
 *   - It renders nothing rather than a placeholder when no reach has been
 *     recorded, so it never implies a reading nobody took.
 *
 * Self-contained: it resolves everything from `local-nodes-store` by bare
 * device id, so any node surface mounts it with one line and no plumbing.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { ArrowRight, Wifi, WifiOff } from "lucide-react";
import { useLocalNodesStore, useReachOkLiveStore } from "@/stores/local-nodes-store";
import { getFreshness, useClockTick } from "@/lib/agent/freshness";
import {
  alternateReach,
  bucketSuggestsOtherAddress,
  reachDisplayHost,
  REACH_ERROR_BUCKETS,
  type ReachErrorBucket,
} from "@/lib/nodes/local-reach";

export interface NodeReachBlockProps {
  /** Bare agent device id (NOT the `node:`-prefixed selection id). */
  deviceId: string | null | undefined;
}

export function NodeReachBlock({ deviceId }: NodeReachBlockProps) {
  const t = useTranslations("command.nodeReach");
  // The "Xs ago" labels count up in lockstep with every other freshness
  // label on the page off the shared 1 Hz clock.
  useClockTick();
  const node = useLocalNodesStore((s) =>
    deviceId ? (s.nodes.find((n) => n.deviceId === deviceId) ?? null) : null,
  );
  const setNodeHostname = useLocalNodesStore((s) => s.setNodeHostname);
  // The persisted stamp is coalesced; the live one moves on every success.
  const liveOkAt = useReachOkLiveStore((s) => (deviceId ? s.at[deviceId] : undefined));

  // Not a LAN-paired node, or nothing has been tried yet: say nothing.
  if (!node || !deviceId) return null;
  const { lastReachOk, lastReachError } = node;
  if (!lastReachOk && !lastReachError) return null;

  const failing = lastReachError !== undefined;
  const bucket = lastReachError ? asBucket(lastReachError.error) : null;
  // A node that answered is reachable at the stored address, so offering a
  // different one would steer the operator into rewriting a working reach.
  const alternate =
    bucket !== null && bucketSuggestsOtherAddress(bucket) ? alternateReach(node) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      {failing ? (
        <WifiOff size={12} className="shrink-0 text-status-warning" />
      ) : (
        <Wifi size={12} className="shrink-0 text-status-success" />
      )}

      {lastReachOk && !failing && (
        <span className="text-text-secondary">
          {t("reachedAt", {
            host: reachDisplayHost(lastReachOk.host),
            ago: getFreshness(Math.max(lastReachOk.at, liveOkAt ?? 0)).label,
          })}
        </span>
      )}

      {lastReachError && (
        <span className="text-text-secondary">
          {t("lastTried", {
            host: reachDisplayHost(lastReachError.host),
            reason: t(`reason.${bucket ?? "unknown"}`),
            ago: getFreshness(lastReachError.at).label,
          })}
        </span>
      )}

      {/* The address that used to work is the operator's fastest route back,
          so it stays on screen through the failure rather than being replaced
          by it. */}
      {lastReachError && lastReachOk && (
        <span className="text-text-tertiary">
          {t("previouslyReachedAt", {
            host: reachDisplayHost(lastReachOk.host),
          })}
        </span>
      )}

      {alternate && (
        <button
          type="button"
          onClick={() => setNodeHostname(node.deviceId, alternate)}
          className="inline-flex items-center gap-1 rounded border border-border-default px-1.5 py-0.5 font-medium text-text-secondary transition-colors hover:border-accent-primary/40 hover:text-text-primary"
        >
          {t("useThisAddress", { host: reachDisplayHost(alternate) })}
          <ArrowRight size={10} />
        </button>
      )}
    </div>
  );
}

/** A persisted bucket from an older schema (or a hand-edited store) is not
 * trusted into the translation key — an unrecognised value reads "unknown"
 * rather than rendering a raw key at the operator. */
function asBucket(value: string): ReachErrorBucket {
  return REACH_ERROR_BUCKETS.find((b) => b === value) ?? "unknown";
}
