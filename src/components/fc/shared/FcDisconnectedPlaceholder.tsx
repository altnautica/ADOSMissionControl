"use client";

/**
 * @module FcDisconnectedPlaceholder
 * @description Shown by FC configuration surfaces when no flight controller is
 * connected. Thin, connection-aware wrapper over the shared LinkUpPlaceholder.
 * For a locally-paired node it tells three cases apart so the empty state is
 * truthful instead of always offering a USB "connect a flight controller"
 * prompt:
 *   - the card is stale (the box was re-flashed or unpaired) → re-pair / remove
 *   - the agent is up but unpaired, so it refuses this GCS its flight link →
 *     pair the node
 *   - the agent link is down (offline / unreachable card) → reconnect / re-pair
 *   - the agent is up but reports no autopilot → the original connect prompt
 * @license GPL-3.0-only
 */

import { LinkUpPlaceholder } from "@/components/shared/link-up/LinkUpPlaceholder";
import {
  openPairNode,
  removeFocusedLocalNode,
} from "@/components/shared/link-up/link-up-actions";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

interface FcDisconnectedPlaceholderProps {
  droneName: string;
  /** True when this node is backed by a companion agent (an SBC), as opposed to
   * a bare direct-connect FC. When the agent is up but reports no autopilot, an
   * agent-backed node shows "companion online, no autopilot on its serial
   * ports" rather than the misleading "connect a flight controller over USB". */
  agentBacked?: boolean;
}

export function FcDisconnectedPlaceholder({
  droneName,
  agentBacked = false,
}: FcDisconnectedPlaceholderProps) {
  const stalePairing = useAgentConnectionStore((s) => s.stalePairing);
  const connected = useAgentConnectionStore((s) => s.connected);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const mavlinkPairRequired = useAgentConnectionStore((s) => s.mavlinkPairRequired);

  // The box at this card's host is reachable but no longer the paired agent
  // (re-flashed → new device id, or unpaired). Offer re-pair + remove.
  if (stalePairing) {
    return (
      <LinkUpPlaceholder
        variant="stale-pairing"
        droneName={droneName}
        onPrimary={openPairNode}
        onSecondary={removeFocusedLocalNode}
      />
    );
  }

  // The agent answers but reports itself unpaired, and an unpaired agent only
  // opens its flight-controller link to its own box or lifeline links. No
  // retry can open it from here: pairing is the way forward.
  if (connected && mavlinkPairRequired) {
    return <LinkUpPlaceholder variant="pair-required" droneName={droneName} />;
  }

  // The agent link itself is down for this LAN node — there is no flight
  // controller to plug into over USB, so route to reconnect / re-pair instead
  // of the misleading connect-FC prompt.
  if (!connected && !cloudMode) {
    return <LinkUpPlaceholder variant="agent-offline" droneName={droneName} />;
  }

  // The agent (companion computer) is reachable but reports no autopilot on its
  // serial ports — telling the operator to "connect a flight controller over
  // USB" is wrong for an SBC-backed drone (the FC is wired to the companion, not
  // the operator's laptop). Point them at the companion's serial link instead.
  if (agentBacked) {
    return <LinkUpPlaceholder variant="no-fc-agent" droneName={droneName} />;
  }

  return <LinkUpPlaceholder variant="no-fc-direct" droneName={droneName} />;
}
