/**
 * @module agent-fc-supervisor
 * @description Keeps one session open to each agent FC `agent-fc-targets`
 * names. Each node gets its own loop: every {@link AGENT_FC_REDIAL_MS} it
 * checks the node's session and dials when there is none, with no cap.
 *
 * A loop stops dialling only for a reason a retry cannot fix: the agent
 * reports it needs pairing, or the operator disconnected the FC on purpose.
 * Pairing lasts until the node's link or its FC report changes, which starts
 * a fresh loop. An operator disconnect lasts until the operator connects the
 * node again (focuses it afresh, or another link attaches its FC) or re-pairs
 * it; leaving the node's page, the next check and a credential change all
 * leave it down. A node with no usable dial path (a drone focused through a
 * ground station's relay) gets no loop. A session closes when its agent
 * reports the FC gone, or when its node stops being a target (the focus moved
 * off an agent that is not LAN-paired in this browser).
 *
 * Owned by `AgentMavlinkBridge`, which feeds it store changes.
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { nodeIdForDevice, resolveNodeId } from "@/lib/agent/node-id";
import { createFcAdapter } from "@/lib/protocol/select-fc-adapter";
import { dialAgentFc, planDialPaths, type AgentDialPlan } from "./agent-mavlink-dial";
import { planAgentFcTargets, targetLinkKey, type AgentFcTarget } from "./agent-fc-targets";

/** Gap between session checks, and so between re-dials of a missing session. */
export const AGENT_FC_REDIAL_MS = 3_000;

function hasDialPath(plan: AgentDialPlan): boolean {
  const paths = planDialPaths(plan);
  return paths.auth || paths.legacy || paths.relay;
}

/** One node's supervision loop. Replaced when the node's link changes. */
interface NodeLoop {
  key: string;
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class AgentFcSupervisor {
  /** Node ids whose session this supervisor opened and still owns. */
  private readonly held = new Set<string>();
  /** Ids whose session dropped without anyone asking. Only those are
   * re-dialled after they vanish; a session removed on purpose stays down. */
  private readonly dropped = new Set<string>();
  private readonly loops = new Map<string, NodeLoop>();
  /** Ids a credential-driven teardown deselected, to select again on re-dial. */
  private readonly reselect = new Set<string>();
  /** Ids the operator disconnected, with the pairing key they had then. Not
   * dialled until the operator connects them again or re-pairs them. */
  private readonly operatorStopped = new Map<string, string | null>();
  /** The agent the operator has focused (device id, else URL), whether or not
   * its link is up. The link flag flips with no operator action. */
  private focusKey: string | null = null;
  /** Set when the operator focuses a different agent; spent by the first
   * focused target that sees it. Only this re-arms an operator-stopped FC. */
  private freshFocus = false;
  /** The id a focused agent with no device identity is attached under. */
  private anon: { agentUrl: string | null; id: string } | null = null;
  private grantEpoch: number | null = null;

  markDropped(droneId: string): void {
    this.dropped.add(droneId);
  }

  /** Stop every loop. The sessions themselves persist across re-renders and
   * route changes; the operator and the reconcile teardowns own ending them. */
  dispose(): void {
    for (const id of Array.from(this.loops.keys())) this.stopLoop(id);
  }

  reconcile(grantEpoch: number): void {
    const manager = useDroneManager.getState();
    if (this.grantEpoch !== null && this.grantEpoch !== grantEpoch) this.dropRelaySessions();
    this.grantEpoch = grantEpoch;

    const conn = useAgentConnectionStore.getState();
    const focusKey = conn.nodeDeviceId ?? conn.agentUrl ?? null;
    if (focusKey !== this.focusKey) {
      this.focusKey = focusKey;
      this.freshFocus = focusKey !== null;
    }
    const targets = this.readTargets();
    for (const id of Array.from(this.held)) {
      const target = targets.get(id);
      if (target && target.fc !== "gone") continue;
      // Closed the moment the agent reports the FC gone, rather than waiting
      // for a transport close that can lag or never fire on a relayed link.
      // An intentional disconnect, so nothing re-dials it.
      this.held.delete(id);
      this.stopLoop(id);
      if (manager.drones.has(id)) manager.disconnectDrone(id);
    }
    for (const [id, target] of targets) {
      const refocused = target.focused && this.freshFocus;
      if (target.focused) this.freshFocus = false;
      if (this.operatorStopped.has(id)) {
        const reconnected = refocused || manager.drones.has(id);
        const repaired = this.operatorStopped.get(id) !== this.pairKey(id);
        if (!reconnected && !repaired) {
          this.stopLoop(id);
          continue;
        }
        this.operatorStopped.delete(id);
      }
      if (target.fc !== "active" || (!this.held.has(id) && !hasDialPath(target.plan))) {
        this.stopLoop(id);
        continue;
      }
      const key = targetLinkKey(target);
      if (this.loops.get(id)?.key === key) continue;
      this.stopLoop(id);
      const loop: NodeLoop = { key, cancelled: false };
      this.loops.set(id, loop);
      void this.supervise(id, loop);
    }
    for (const id of Array.from(this.loops.keys())) {
      if (!targets.has(id)) this.stopLoop(id);
    }
  }

  /** The LAN pairing key held for a node id, so a re-pair can be told apart. */
  private pairKey(id: string): string | null {
    const node = useLocalNodesStore
      .getState()
      .nodes.find((n) => nodeIdForDevice(n.deviceId) === id);
    return node?.apiKey ?? null;
  }

  private readTargets(): Map<string, AgentFcTarget> {
    const conn = useAgentConnectionStore.getState();
    if (conn.connected && !conn.nodeDeviceId && this.anon?.agentUrl !== conn.agentUrl) {
      this.anon = { agentUrl: conn.agentUrl, id: resolveNodeId(undefined) };
    }
    return planAgentFcTargets({
      focus: {
        connected: conn.connected,
        nodeDeviceId: conn.nodeDeviceId,
        mavlinkUrl: conn.mavlinkUrl,
        agentUrl: conn.agentUrl,
        apiKey: conn.apiKey,
        cloudDeviceId: conn.cloudDeviceId,
        status: useAgentSystemStore.getState().status,
      },
      focusAnonId: this.anon?.id ?? "",
      lanNodes: useLocalNodesStore.getState().nodes,
      lanStatuses: useCommandFleetStore.getState().cloudStatuses,
      pageSecure: typeof window !== "undefined" && window.location.protocol === "https:",
    });
  }

  /**
   * A minted write grant changes the broker principal, and an MQTT client
   * cannot swap credentials on a live socket. So when the credential changes,
   * drop every relay session: the fresh loops re-dial in the same breath, this
   * time as a command link. A WebSocket FC carries its own authority and is
   * left alone.
   */
  private dropRelaySessions(): void {
    const manager = useDroneManager.getState();
    for (const id of Array.from(this.held)) {
      if (manager.drones.get(id)?.transport.type !== "mqtt-mavlink") continue;
      // Read the selection BEFORE removing: removal clears it when the drone
      // is the selected one, and a renewal must not move the operator off it.
      if (manager.selectedDroneId === id) this.reselect.add(id);
      this.held.delete(id);
      manager.disconnectDrone(id);
    }
    this.dispose();
  }

  private stopLoop(id: string): void {
    const loop = this.loops.get(id);
    if (!loop) return;
    loop.cancelled = true;
    clearTimeout(loop.timer);
    this.loops.delete(id);
  }

  private schedule(id: string, loop: NodeLoop): void {
    if (!loop.cancelled) {
      loop.timer = setTimeout(() => void this.supervise(id, loop), AGENT_FC_REDIAL_MS);
    }
  }

  private async supervise(id: string, loop: NodeLoop): Promise<void> {
    if (loop.cancelled) return;
    const manager = useDroneManager.getState();
    if (this.held.has(id)) {
      if (manager.drones.has(id)) {
        this.schedule(id, loop);
        return;
      }
      this.held.delete(id);
      if (!this.dropped.has(id)) {
        // Removed on purpose (the operator disconnected it): stay down, across
        // fresh loops too, until the operator connects it again.
        this.operatorStopped.set(id, this.pairKey(id));
        this.loops.delete(id);
        return;
      }
      this.dropped.delete(id);
    } else if (manager.drones.has(id)) {
      // Another link already carries this node's FC: leave it to its owner.
      this.schedule(id, loop);
      return;
    }
    if (await this.connectOnce(id, loop)) this.schedule(id, loop);
  }

  /** One dial. Returns false when a retry cannot help (pairing required). */
  private async connectOnce(id: string, loop: NodeLoop): Promise<boolean> {
    // Read at attempt time: the key and the dial plan move together, but the
    // FC report and the MSP lane can change between checks.
    const target = this.readTargets().get(id);
    if (!target || target.fc !== "active") return true;
    const outcome = await dialAgentFc(target.plan, () => loop.cancelled);
    if (!outcome.transport) {
      if (!loop.cancelled) console.warn("[AgentMavlinkBridge] All MAVLink connection methods failed");
      return !outcome.pairRequired;
    }
    const transport = outcome.transport;
    let handedOff = false;
    try {
      if (loop.cancelled) return false;
      // Betaflight/iNav → MSP over the byte-transparent transport;
      // ArduPilot / PX4 / unidentified → MAVLink.
      const adapter = await createFcAdapter(target.fcVariant);
      const vehicleInfo = await adapter.connect(transport);
      if (loop.cancelled) {
        adapter.disconnect().catch(() => {});
        return false;
      }
      const name =
        useNodeRegistryStore.getState().getEntry(id)?.presence.name || target.name || "Drone";
      // A node's presence bridge owns its row; only a focused agent with no
      // device identity owns a standalone one. A background session never
      // takes the operator's selection.
      useDroneManager.getState().addDrone(
        id,
        name,
        adapter,
        transport,
        vehicleInfo,
        { type: outcome.connType, url: target.plan.mavlinkUrl || undefined },
        { ownsFleetRow: target.ownsFleetRow, autoSelect: target.focused },
      );
      handedOff = true;
      this.held.add(id);
      this.dropped.delete(id);
      // Restore a selection a credential-driven teardown cleared.
      if (this.reselect.delete(id)) useDroneManager.getState().selectDrone(id);
    } catch (err) {
      console.warn("[AgentMavlinkBridge] MAVLink connection failed:", err);
    } finally {
      // A transport that connected but was never handed to the drone manager
      // (the handshake threw, or the loop was cancelled) would leak a socket.
      if (!handedOff) {
        try {
          transport.disconnect();
        } catch {
          // best-effort teardown
        }
      }
    }
    return !loop.cancelled;
  }
}
