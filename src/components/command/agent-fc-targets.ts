/**
 * @module agent-fc-targets
 * @description Which agent FC sessions the GCS keeps open, and how each one
 * is dialled. Two sources name them:
 *
 *   - the focused agent (`useAgentConnectionStore`), whatever its transport:
 *     LAN, cloud relay, or a ground station's relay proxy;
 *   - every LAN-paired node held in this browser (`useLocalNodesStore`), whose
 *     agent the fleet poll reports with an FC. These are kept whether or not
 *     the operator has focused them: a page loaded fresh has no focus, and
 *     leaving a node's page releases it, yet the planner, the fleet and every
 *     route still need the vehicle.
 *
 * A node named by both is one target: the focused agent's live status and
 * dial plan win, and the fleet poll stands in while the focus has no status.
 *
 * A ground station's MAVLink port republishes every drone it relays, so a
 * session on it is not one aircraft's; `RelayedMavlinkBridge` opens those per
 * drone. On an HTTPS page the browser blocks the plain-HTTP LAN reach, so no
 * LAN-paired node is dialled from one.
 *
 * Pure: the bridge reads the stores and passes their state in.
 * @license GPL-3.0-only
 */
import type { AgentDialPlan } from "./agent-mavlink-dial";
import type { AgentStatus } from "@/lib/agent/types";
import { agentMavlinkWsUrl } from "@/stores/agent-connection/client-manager/mavlink-url";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { isMspVariant } from "@/lib/protocol/select-fc-adapter";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import type { LocalNode } from "@/stores/local-nodes-store";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";

/** What the agent last said about its FC: one to dial, none, or nothing yet. */
export type AgentFcReport = "active" | "gone" | "unknown";

export interface AgentFcTarget {
  /** The drone-manager id: `node:<deviceId>`, or a direct-FC id for a focused
   * agent with no device identity. */
  droneId: string;
  fc: AgentFcReport;
  plan: AgentDialPlan;
  fcVariant: string | undefined;
  /** The operator's focused agent. Its session may take the selection and
   * owns a standalone fleet row when the agent has no device identity. */
  focused: boolean;
  ownsFleetRow: boolean;
  /** The agent's name for the FC, when the node registry has none. */
  name: string | undefined;
}

export interface FocusedAgentState {
  connected: boolean;
  nodeDeviceId: string | null;
  mavlinkUrl: string | null;
  agentUrl: string | null;
  apiKey: string | null;
  cloudDeviceId: string | null;
  status: Pick<AgentStatus, "fc_connected" | "fc_variant" | "transport_open" | "board"> | null;
}

export interface AgentFcTargetInput {
  focus: FocusedAgentState;
  /** The id a focused agent with no device identity is attached under. */
  focusAnonId: string;
  lanNodes: readonly LocalNode[];
  lanStatuses: Readonly<Record<string, CommandCloudStatus | undefined>>;
  pageSecure: boolean;
}

/** The facts whose change makes a dial plan a different link. */
export function targetLinkKey(t: AgentFcTarget): string {
  return [t.plan.mavlinkUrl, t.plan.agentUrl, t.plan.cloudDeviceId, t.focused].join("|");
}

export function planAgentFcTargets(input: AgentFcTargetInput): Map<string, AgentFcTarget> {
  const targets = new Map<string, AgentFcTarget>();

  if (!input.pageSecure) {
    for (const node of input.lanNodes) {
      if (node.profile === "ground-station" || !node.hostname || !node.apiKey) continue;
      const row = input.lanStatuses[node.deviceId];
      const droneId = nodeIdForDevice(node.deviceId);
      targets.set(droneId, {
        droneId,
        fc: row ? (isFcReachable(row) ? "active" : "gone") : "unknown",
        plan: {
          mavlinkUrl: agentMavlinkWsUrl(node.hostname),
          agentUrl: node.hostname,
          apiKey: node.apiKey,
          cloudDeviceId: null,
          mspLane: isMspVariant(row?.fcVariant),
          reportPairing: false,
        },
        fcVariant: row?.fcVariant,
        focused: false,
        ownsFleetRow: false,
        name: node.name || undefined,
      });
    }
  }

  const { focus } = input;
  if (focus.connected) {
    const droneId = focus.nodeDeviceId ? nodeIdForDevice(focus.nodeDeviceId) : input.focusAnonId;
    const status = focus.status;
    const fc: AgentFcReport = status
      ? isFcReachable({
          fcConnected: status.fc_connected,
          fcVariant: status.fc_variant,
          transportOpen: status.transport_open,
        })
        ? "active"
        : "gone"
      : "unknown";
    const lan = targets.get(droneId);
    targets.set(droneId, {
      droneId,
      fc: fc === "unknown" && lan ? lan.fc : fc,
      plan: {
        mavlinkUrl: focus.mavlinkUrl,
        agentUrl: focus.agentUrl,
        apiKey: focus.apiKey,
        cloudDeviceId: focus.cloudDeviceId,
        mspLane: isMspVariant(status?.fc_variant ?? lan?.fcVariant),
        reportPairing: true,
      },
      fcVariant: status?.fc_variant ?? lan?.fcVariant,
      focused: true,
      ownsFleetRow: !focus.nodeDeviceId,
      name: status?.board?.name ?? lan?.name,
    });
  }

  return targets;
}
