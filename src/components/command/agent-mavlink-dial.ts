/**
 * @module agent-mavlink-dial
 * @description One dial of the agent's FC link, tried over three paths in
 * order:
 *
 *   1. Authenticated WebSocket — the agent's raw MAVLink proxy URL dialed with
 *      a freshly-minted one-shot ticket carried as a WebSocket subprotocol.
 *      Authentication is orthogonal to the URL: the same proxy validates the
 *      ticket subprotocol for any profile. Used when a pairing key is held.
 *   2. Legacy raw WebSocket — the same proxy URL dialed bare (no subprotocol),
 *      for an agent with no key held. An unpaired agent admits that only from
 *      its own box or a lifeline link, so off one the agent is asked first and
 *      an unpaired answer raises the pair-this-node state instead of a dial.
 *   3. MQTT relay (via the cloud relay) — works from anywhere.
 *
 * AgentMavlinkBridge owns the session and calls this once per attempt.
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { Transport } from "@/lib/protocol/types/transport";
import {
  mintWsTicket,
  WS_TICKET_PROTOCOL,
} from "@/lib/api/ground-station/ws-ticket";
import {
  agentReportsUnpaired,
  isAgentLifelineHost,
} from "@/lib/agent/unpaired-mavlink-gate";
import { relayWriteAuthFor } from "@/stores/mqtt-control-grant-store";

const WS_TIMEOUT_MS = 3000;

// Ports the MAVLink bridge will refuse to dial on a derived ws:// URL even if
// the agent advertises one. 5760 is the ArduPilot SITL TCP listener; a stale
// advertised URL naming it must never be dialed as if it were the agent.
const FORBIDDEN_DERIVED_WS_PORTS = new Set(["5760"]);

/** What one dial needs, read at attempt time. */
export interface AgentDialPlan {
  mavlinkUrl: string | null;
  /** The agent's prior WebSocket URL, retried once after a binding rotation. */
  mavlinkWsUrlPrev: string | null;
  agentUrl: string | null;
  apiKey: string | null;
  cloudDeviceId: string | null;
  /** True for an MSP FC (Betaflight/iNav), which rides the relay's MSP lane. */
  mspLane: boolean;
}

/** Which dial paths a plan can use. */
export interface AgentDialPaths {
  /** Ticketed WebSocket (a key is held and the URL is usable). */
  auth: boolean;
  /** Bare WebSocket (usable URL, not blocked as mixed content). */
  legacy: boolean;
  /** Cloud MQTT relay. */
  relay: boolean;
}

export type AgentDialOutcome =
  | { transport: Transport; connType: "websocket" | "mqtt-mavlink" }
  | { transport: null; pairRequired: boolean };

function pageIsSecure(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

/**
 * Work out which paths can carry a dial. The MAVLink URL must parse, avoid a
 * forbidden port and (when an agent URL is set) share the agent's host. On an
 * HTTPS page a bare ws:// dial is mixed content, so only the ticketed dial,
 * upgraded to wss://, survives. A development server with no WebSocket path
 * skips the cloud relay: there is no relay infrastructure behind a bench
 * build, and the attempt could only time out.
 */
export function planDialPaths(plan: AgentDialPlan): AgentDialPaths {
  const { mavlinkUrl, agentUrl, apiKey, cloudDeviceId } = plan;
  let urlUsable = !!mavlinkUrl;
  let legacy = !!mavlinkUrl;
  if (mavlinkUrl) {
    try {
      const wsUrl = new URL(mavlinkUrl);
      if (FORBIDDEN_DERIVED_WS_PORTS.has(wsUrl.port)) {
        urlUsable = false;
      } else if (agentUrl && wsUrl.hostname !== new URL(agentUrl).hostname) {
        urlUsable = false;
      }
      legacy = urlUsable && !(pageIsSecure() && wsUrl.protocol === "ws:");
    } catch {
      urlUsable = false;
      legacy = false;
    }
  }
  const auth = urlUsable && !!apiKey && !!agentUrl;
  const benchBuild = process.env.NODE_ENV === "development";
  const relay = !!cloudDeviceId && !(benchBuild && !auth && !legacy);
  return { auth, legacy, relay };
}

/**
 * Force a ws:// URL to wss:// when the page is served over https, so the
 * authenticated dial isn't blocked as mixed content. Returns null on a
 * malformed URL so the caller can skip the dial.
 */
function secureWsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (pageIsSecure() && u.protocol === "ws:") u.protocol = "wss:";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Dial the agent's FC once over the first path that answers. `isCancelled` is
 * checked after every await; a cancelled dial closes anything it opened and
 * reports no transport.
 */
export async function dialAgentFc(
  plan: AgentDialPlan,
  isCancelled: () => boolean,
): Promise<AgentDialOutcome> {
  const paths = planDialPaths(plan);
  const { mavlinkUrl, mavlinkWsUrlPrev, agentUrl, apiKey, cloudDeviceId } = plan;
  const none = { transport: null, pairRequired: false } as const;

  // Loaded lazily: the transports (MQTT especially) are heavy and most
  // sessions never dial an agent FC.
  const { WebSocketTransport } = await import("@/lib/protocol/transport/websocket");
  const tryWs = async (
    url: string,
    protocols?: string | string[],
  ): Promise<InstanceType<typeof WebSocketTransport>> => {
    const wsTransport = new WebSocketTransport();
    const timeout = Promise.withResolvers<never>();
    const timer = setTimeout(() => timeout.reject(new Error("timeout")), WS_TIMEOUT_MS);
    try {
      await Promise.race([wsTransport.connect(url, protocols), timeout.promise]);
    } catch (err) {
      // The race only abandons the connect; the socket underneath may still
      // complete on a slow agent and would be left with no owner.
      try {
        await wsTransport.disconnect();
      } catch {
        /* already dead */
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return wsTransport;
  };

  // Try 1: ticketed dial. The ticket rides as a subprotocol so it never
  // reaches the URL; on a secure origin the URL is upgraded to wss://.
  if (paths.auth && mavlinkUrl && agentUrl && apiKey) {
    const secured = secureWsUrl(mavlinkUrl);
    if (secured) {
      try {
        const ticket = await mintWsTicket({ baseUrl: agentUrl, apiKey }, "gs.mavlink_ws");
        if (isCancelled()) return none;
        if (ticket) {
          const transport = await tryWs(secured, [WS_TICKET_PROTOCOL, ticket]);
          return { transport, connType: "websocket" };
        }
      } catch {
        /* next path */
      }
    }
  }

  // Try 2: bare dial (open posture). With no key held the agent must admit a
  // keyless caller. An unpaired agent refuses anyone not on its own box or a
  // lifeline, and the browser is never told why a handshake failed, so off a
  // lifeline the agent is asked first and on one it is asked only when the
  // dial is refused. A definitive "unpaired" raises pair-this-node.
  let pairRequired = false;
  if (paths.legacy && mavlinkUrl) {
    const keylessProbeBase = !apiKey && agentUrl ? agentUrl : null;
    const onLifeline = isAgentLifelineHost(new URL(mavlinkUrl).hostname);
    pairRequired =
      keylessProbeBase !== null && !onLifeline
        ? await agentReportsUnpaired(keylessProbeBase)
        : false;
    if (isCancelled()) return none;
    let transport: Transport | undefined;
    if (!pairRequired) {
      try {
        transport = await tryWs(mavlinkUrl);
      } catch {
        // Retry the prior URL once (handles an agent WS-binding rotation).
        if (mavlinkWsUrlPrev && mavlinkWsUrlPrev !== mavlinkUrl) {
          try {
            transport = await tryWs(mavlinkWsUrlPrev);
          } catch {
            /* next path */
          }
        }
      }
      if (!transport && keylessProbeBase !== null && onLifeline) {
        pairRequired = await agentReportsUnpaired(keylessProbeBase);
        if (isCancelled()) return none;
      }
    }
    useAgentConnectionStore.getState().setMavlinkPairRequired(pairRequired);
    if (transport) return { transport, connType: "websocket" };
  }

  // Try 3: MQTT relay. An MSP FC rides the agent's MSP topic lane.
  if (paths.relay && cloudDeviceId) {
    try {
      const { MqttMavlinkTransport } = await import(
        "@/lib/protocol/transport/mqtt-mavlink"
      );
      const mqttTransport = new MqttMavlinkTransport(plan.mspLane ? "msp" : "mavlink");
      // The operator's minted write grant, read now so a dial that races a
      // renewal uses the live credential. Without one the session connects
      // receive-only and the transport says so.
      await mqttTransport.connect(cloudDeviceId, undefined, relayWriteAuthFor(cloudDeviceId));
      if (!mqttTransport.canCommand) {
        console.warn(
          "[AgentMavlinkBridge] Relay session is receive-only: telemetry will " +
            "flow but commands cannot be sent to this vehicle",
        );
      }
      return { transport: mqttTransport, connType: "mqtt-mavlink" };
    } catch (mqttErr) {
      console.warn("[AgentMavlinkBridge] MQTT relay failed:", mqttErr);
    }
  }

  return { transport: null, pairRequired };
}
