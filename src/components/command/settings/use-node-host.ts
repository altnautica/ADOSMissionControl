"use client";

/**
 * @module command/settings/use-node-host
 * @description What kind of machine the node runs on, and whether it may be
 * reached from the network.
 *
 * The agent reports both on `/api/status`: `host_kind` (`"appliance"` on a
 * dedicated box, `"personal"` on a laptop or desktop somebody also uses) and
 * `share_on_lan`. Mission Control uses them to decide which configuration a
 * node is even capable of running: a personal ground station has no access
 * point, no HDMI kiosk and no status panel, so offering those pages would
 * present settings the node never applies.
 *
 * Absent, unreadable or unrecognised reads as `"appliance"`: that is the
 * behaviour every node had before the field existed, and showing a laptop's
 * full appliance settings is wrong in a recoverable way, while hiding a real
 * appliance's access-point page is not.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { loopbackInit } from "@/lib/nodes/loopback";
import { useNodeDirectAgent } from "./use-node-direct-agent";

/** The kind of machine an agent is installed on. */
export type HostKind = "appliance" | "personal";

/** One node's host facts, as `/api/status` reports them. */
export interface NodeHost {
  hostKind: HostKind;
  /** Whether phones and tablets on the network may reach this node. */
  shareOnLan: boolean;
}

/** The safe default: a node that has not answered yet is shown as an appliance. */
const UNKNOWN_HOST: NodeHost = { hostKind: "appliance", shareOnLan: true };

/**
 * Parse the two fields out of a status body, tolerating anything else.
 * Exported for the tests: the fallback is the whole contract.
 */
export function parseNodeHost(body: unknown): NodeHost {
  if (!body || typeof body !== "object") return UNKNOWN_HOST;
  const record = body as Record<string, unknown>;
  const hostKind = record.host_kind === "personal" ? "personal" : "appliance";
  // An appliance always serves the LAN (that is what it is for); only a personal
  // host carries a meaningful flag. A missing flag on a personal host reads as
  // not shared, which is the install's default and the safe side.
  const shareOnLan =
    hostKind === "appliance" ? true : record.share_on_lan === true;
  return { hostKind, shareOnLan };
}

/**
 * @param nodeDeviceId The device id of the node the page is rendered for.
 * @returns Its host facts, from its own `/api/status`. `UNKNOWN_HOST` while the
 *   read is in flight, when there is no direct connection, or on any failure.
 */
export function useNodeHost(nodeDeviceId: string | null): NodeHost {
  const transport = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = transport?.agentUrl ?? null;
  const apiKey = transport?.apiKey ?? null;
  // Keyed by the URL it was read from, so a node switch never shows the
  // previous node's answer while the new read is in flight.
  const [read, setRead] = useState<{ url: string; host: NodeHost } | null>(null);

  useEffect(() => {
    if (!agentUrl) return;
    let cancelled = false;
    const url = `${agentUrl.replace(/\/$/, "")}/api/status`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-ADOS-Key"] = apiKey;
    fetch(url, loopbackInit(url, { headers }))
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setRead({ url: agentUrl, host: parseNodeHost(body) });
      })
      .catch(() => {
        if (!cancelled) setRead({ url: agentUrl, host: UNKNOWN_HOST });
      });
    return () => {
      cancelled = true;
    };
  }, [agentUrl, apiKey]);

  return read && read.url === agentUrl ? read.host : UNKNOWN_HOST;
}
