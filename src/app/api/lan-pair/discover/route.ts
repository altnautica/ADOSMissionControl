/**
 * @module LanPairDiscoverRoute
 * @description Server-side mDNS browser for ADOS agents on the LAN.
 * Uses ``bonjour-service`` to query ``_ados._tcp.local.`` and returns
 * the responders within a fixed time budget. Lets the GCS resolve a
 * 6-character pair code locally without a Convex round-trip — the
 * client gets a list of candidate agents, fetches ``/api/pairing/info``
 * on each, and picks the one whose ``pairing_code`` matches.
 *
 * Runs Node-only (mDNS multicast over UDP 5353 needs raw sockets).
 * Inside a Docker container without ``network_mode: host`` — the usual
 * hosted deployment — the multicast scan returns an empty list; the
 * caller's Convex fallback path takes over there.
 *
 * @license GPL-3.0-only
 */

import { NextResponse } from "next/server";
import { Bonjour } from "bonjour-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DiscoveredAgent {
  /** mDNS hostname (e.g. ``ados-bda6b4.local``). */
  host: string;
  /** IPv4 address from the SRV/A record, when available. */
  ipv4?: string;
  /** REST port advertised by the agent. */
  port: number;
  /** TXT-record metadata when the agent publishes any. */
  txt: Record<string, string>;
}

const DISCOVER_WINDOW_MS = 3000;

function pickIpv4(addresses: string[] | undefined): string | undefined {
  if (!addresses) return undefined;
  return addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
}

function normaliseTxt(txt: unknown): Record<string, string> {
  if (!txt || typeof txt !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(txt as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
    else if (Buffer.isBuffer(v)) out[k] = v.toString("utf8");
  }
  return out;
}

export async function GET() {
  const bonjour = new Bonjour();
  const agents = new Map<string, DiscoveredAgent>();

  try {
    const browser = bonjour.find({ type: "ados" });

    browser.on("up", (service) => {
      const host = (service.host ?? "").replace(/\.$/, "");
      if (!host) return;
      const entry: DiscoveredAgent = {
        host,
        ipv4: pickIpv4(service.addresses),
        port: typeof service.port === "number" ? service.port : 8080,
        txt: normaliseTxt(service.txt),
      };
      agents.set(host, entry);
    });

    await new Promise<void>((resolve) =>
      setTimeout(resolve, DISCOVER_WINDOW_MS),
    );

    browser.stop();
  } finally {
    bonjour.destroy();
  }

  return NextResponse.json({
    agents: Array.from(agents.values()),
  });
}
