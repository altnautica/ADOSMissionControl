"use client";

/**
 * @module AgentBridges
 * @description Route-agnostic mount for the agent-state bridges. These all
 * render null and key off the global connection / pairing stores, so they keep
 * the per-device fleet status, cloud heartbeats, and MQTT telemetry live on
 * every route, not just the Command page. Mounted once in CommandShell so a
 * drone selected on the Dashboard shows live companion-computer data in place.
 *
 * AgentMavlinkBridge is mounted separately in CommandShell (it owns the FC
 * link and must persist across selection changes).
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";
import { isDemoMode } from "@/lib/utils";
import { CommandFleetMqttBridge } from "./CommandFleetMqttBridge";
import { MqttControlGrantBridge } from "./MqttControlGrantBridge";
import { CommandFleetStatusBridge } from "./CommandFleetStatusBridge";
import { CommandFleetLocalBridge } from "./CommandFleetLocalBridge";
import { VisionDetectionsBridge } from "./VisionDetectionsBridge";

const CloudStatusBridge = dynamic(
  () => import("./CloudStatusBridge").then((m) => ({ default: m.CloudStatusBridge })),
  { ssr: false },
);
const CloudCommandResultBridge = dynamic(
  () => import("./CloudCommandResultBridge").then((m) => ({ default: m.CloudCommandResultBridge })),
  { ssr: false },
);
const MqttBridge = dynamic(
  () => import("./MqttBridge").then((m) => ({ default: m.MqttBridge })),
  { ssr: false },
);

export function AgentBridges() {
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const fleetNodes = useFleetNodes();
  // The public config carries the broker URL and other non-secrets. It carries
  // no credential: the browser's broker credential is the operator's own minted
  // write grant, which `MqttControlGrantBridge` obtains and injects into the
  // singleton every MQTT client below reads at connect time.
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);

  // In demo the mock engine seeds the fleet + agent stores directly; the real
  // cloud/MQTT/LAN bridges would only fail to reach a broker and spam retries.
  if (demoMode || isDemoMode()) return null;

  return (
    <>
      <MqttControlGrantBridge />
      <CommandFleetStatusBridge enabled={pairedDrones.length > 0} />
      <CommandFleetLocalBridge enabled={fleetNodes.length > 0} />
      {/* Opens the selected drone's detection WS local-first (host+key from
          local-nodes-store), so bounding boxes flow on any tab. */}
      <VisionDetectionsBridge />
      <CommandFleetMqttBridge
        pairedDrones={pairedDrones}
        mqttBrokerUrl={clientConfig?.mqttBrokerUrl}
      />
      {cloudMode && <CloudStatusBridge />}
      {cloudMode && <CloudCommandResultBridge />}
      {cloudMode && (
        <MqttBridge mqttBrokerUrl={clientConfig?.mqttBrokerUrl} />
      )}
    </>
  );
}
