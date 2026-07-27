/**
 * @module nodeClickHandler
 * @description One canonical "connect a node" path shared by the node
 * sidebar list, the collapsed icon rail, and the post-pair handoff.
 *
 * `connectLocalNode` is the single entry point for browser-local
 * (LAN-paired) nodes: it resolves the hostname + apiKey from the
 * local-nodes store (never from caller args, which are empty right
 * after pairing), selects the fleet row, and branches LAN-vs-cloud.
 * On HTTPS, locally-paired nodes go through the cloud relay because
 * the browser blocks mixed-content fetches to ``http://*.local``; on
 * HTTP origins the direct REST path is preferred so the pair stays a
 * single round-trip. `selectNode` routes local nodes through it, sends
 * cloud-paired entries to the relay, and dials a node reached only over
 * another node's radio through that ground station's relay-proxy route —
 * or, when the ground station is not paired here, says so rather than
 * opening a connection that can never answer.
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  relayProxyBaseUrl,
  resolveRelayReach,
} from "@/lib/nodes/relay-reach";

interface SelectNodeOpts {
  /** Switch the page into single-agent view. */
  onFocusAgent: () => void;
  /** Optional callback fired when the connect cannot proceed. */
  onError?: (message: string) => void;
}

/**
 * Connect a browser-local (LAN-paired) node by deviceId. The hostname
 * and apiKey are read from the local-nodes store rather than passed in,
 * because the post-pair handoff forwards only the deviceId (the
 * credentials are already persisted by the pair flow). Selects the
 * `local:<deviceId>` fleet row, tears down any prior connection, then
 * connects via the cloud relay on HTTPS or the direct LAN REST path on
 * HTTP. This is the one place local-node connection logic lives.
 */
export function connectLocalNode(
  deviceId: string,
  opts: SelectNodeOpts,
): void {
  const conn = useAgentConnectionStore.getState();
  // The canonical selection id is `node:<deviceId>` (see node-id + the registry
  // projection) — the same id a cloud observation of this node would carry.
  usePairingStore.getState().selectPairedDrone(nodeIdForDevice(deviceId));
  opts.onFocusAgent();
  // connect() and connectCloud() both mutate agentUrl / apiKey / cloudMode
  // without an atomic transition, so tear down any prior connection first.
  conn.disconnect();

  const onHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";
  if (onHttps) {
    // Mixed-content block: the browser refuses to fetch http://*.local from
    // an https origin. The cloud relay is the only reachable path (and only
    // when the agent beacons there).
    conn.connectCloud(deviceId);
    return;
  }

  const local = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (!local?.hostname || !local.apiKey) {
    // Surface the real reason instead of a silent cloud fall-through that
    // produces a misleading timeout later.
    useAgentConnectionStore.setState({
      connectionError:
        "Missing LAN credentials for this node. Re-pair it from the Add-a-Node card.",
    });
    opts.onError?.("missing_lan_credentials");
    return;
  }
  // Pass the deviceId so nodeDeviceId is set synchronously: the FC's MAVLink
  // session then reconciles to this node's local-<deviceId> card instead of
  // racing to a standalone agent-<timestamp> row.
  void conn.connect(local.hostname, local.apiKey, deviceId);
}

export async function selectNode(
  node: FleetNodeEntry,
  opts: SelectNodeOpts,
): Promise<void> {
  if (node.isLocal) {
    connectLocalNode(node.deviceId, opts);
    return;
  }
  const conn = useAgentConnectionStore.getState();
  usePairingStore.getState().selectPairedDrone(node._id);
  opts.onFocusAgent();
  // Selecting always tears down the prior node's connection, whether or not a
  // new one can be opened, so the panel never shows the previous node's agent.
  conn.disconnect();

  // Not every non-local node is a cloud node. One enrolled solely through
  // another node's radio relay was never paired with the GCS at all, so there
  // is no LAN or cloud identity to dial for it. What there IS, when the ground
  // station it hangs off is LAN-paired on this browser, is that ground
  // station's relay-proxy route: an AgentClient pointed at
  // `<groundStation>/api/v1/ground-station/relay-proxy/<peerDeviceId>` reaches
  // this drone's own HTTP API over the radio, so every agent surface reads the
  // drone's real data. Checked directly off `node.isRelayed` (not through the
  // command lane resolver) so this decision never drifts with what the
  // resolver reports once a live session exists.
  //
  // `RelayedMavlinkBridge` opens the FC link in the background, independent of
  // selection, so the relay connect deliberately skips the `mavlinkUrl`
  // derivation (`{ relay: true }`) — that URL would name the ground station.
  if (node.isRelayed) {
    const reach = resolveRelayReach({
      agentDeviceId: null,
      reachedVia: node.reachedVia,
      droneDeviceId: node.deviceId,
    });
    if (reach) {
      await conn.connect(
        relayProxyBaseUrl(reach),
        reach.apiKey,
        node.deviceId,
        { relay: true },
      );
      return;
    }
    const message =
      "This node is reached through another node's radio relay, and that ground station is not paired on this browser. Pair the ground station from the Add-a-Node card to reach this drone's agent.";
    useAgentConnectionStore.setState({ connectionError: message });
    opts.onError?.("relay_only");
    return;
  }

  // Cloud-paired entry → relay.
  try {
    conn.connectCloud(node.deviceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    useAgentConnectionStore.setState({ connectionError: msg });
    opts.onError?.(msg);
  }
}
