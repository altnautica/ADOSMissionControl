/**
 * @module AgentStore
 * @description Re-export hub for split agent stores. Provides backward-compatible
 * useAgentStore facade for consumers that haven't migrated to specific stores yet.
 *
 * Sub-stores:
 * - agent-connection-store: Connection lifecycle, client, cloud mode, polling
 * - agent-system-store: Status, services, resources, CPU/memory history, logs
 * - agent-peripherals-store: Peripheral devices
 * - agent-scripts-store: Scripts, suites, fleet network
 *
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore, type AgentConnectionStore } from "./agent-connection-store";
import { useAgentSystemStore, type AgentSystemStore } from "./agent-system-store";
import { useAgentPeripheralsStore, type AgentPeripheralsStore } from "./agent-peripherals-store";
import { useAgentScriptsStore, type AgentScriptsStore } from "./agent-scripts-store";

export { useAgentConnectionStore, type AgentConnectionStore };
export { useAgentSystemStore, type AgentSystemStore };
export { useAgentPeripheralsStore, type AgentPeripheralsStore };
export { useAgentScriptsStore, type AgentScriptsStore };

// ── Backward-compatible combined store facade ──────────────────────────
// Merges all 4 sub-stores into a single selector interface so existing
// consumers (`useAgentStore((s) => s.connected)`) continue to work.
// New code should import from specific sub-stores directly.

type CombinedAgentState = AgentConnectionStore & AgentSystemStore & AgentPeripheralsStore & AgentScriptsStore;

/**
 * @deprecated Use specific stores (useAgentConnectionStore, useAgentSystemStore, etc.) instead.
 * This facade exists for backward compatibility during the migration period.
 */
export function useAgentStore<T>(selector: (state: CombinedAgentState) => T): T {
  const conn = useAgentConnectionStore(s => s);
  const sys = useAgentSystemStore(s => s);
  const periph = useAgentPeripheralsStore(s => s);
  const scripts = useAgentScriptsStore(s => s);
  const combined = { ...conn, ...sys, ...periph, ...scripts } as CombinedAgentState;
  return selector(combined);
}

// Static methods for imperative access (getState/setState pattern)
useAgentStore.getState = (): CombinedAgentState => {
  const conn = useAgentConnectionStore.getState();
  const sys = useAgentSystemStore.getState();
  const periph = useAgentPeripheralsStore.getState();
  const scripts = useAgentScriptsStore.getState();
  return { ...conn, ...sys, ...periph, ...scripts } as CombinedAgentState;
};

useAgentStore.setState = (partial: Partial<CombinedAgentState>) => {
  // Route state updates to the appropriate sub-store
  const connKeys = new Set<string>(["agentUrl", "apiKey", "connected", "client", "connectionError", "pollInterval", "cloudMode", "cloudDeviceId", "mqttConnected", "lastCloudUpdate"]);
  const sysKeys = new Set<string>(["status", "services", "resources", "logs", "cpuHistory", "memoryHistory", "processCpuPercent", "processMemoryMb"]);
  const periphKeys = new Set<string>(["peripherals"]);

  const connPartial: Record<string, unknown> = {};
  const sysPartial: Record<string, unknown> = {};
  const periphPartial: Record<string, unknown> = {};
  const scriptsPartial: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(partial)) {
    if (connKeys.has(key)) connPartial[key] = value;
    else if (sysKeys.has(key)) sysPartial[key] = value;
    else if (periphKeys.has(key)) periphPartial[key] = value;
    else scriptsPartial[key] = value;
  }

  if (Object.keys(connPartial).length) useAgentConnectionStore.setState(connPartial as Partial<AgentConnectionStore>);
  if (Object.keys(sysPartial).length) useAgentSystemStore.setState(sysPartial as Partial<AgentSystemStore>);
  if (Object.keys(periphPartial).length) useAgentPeripheralsStore.setState(periphPartial as Partial<AgentPeripheralsStore>);
  if (Object.keys(scriptsPartial).length) useAgentScriptsStore.setState(scriptsPartial as Partial<AgentScriptsStore>);
};
