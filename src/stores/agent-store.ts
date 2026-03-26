/**
 * @module AgentStore
 * @description Re-export hub for split agent stores. Provides backward-compatible
 * useAgentStore for consumers that haven't migrated to specific stores yet.
 *
 * Sub-stores:
 * - agent-connection-store: Connection lifecycle, client, cloud mode, polling
 * - agent-system-store: Status, services, resources, CPU/memory history, logs
 * - agent-peripherals-store: Peripheral devices
 * - agent-scripts-store: Scripts, suites, fleet network
 *
 * @license GPL-3.0-only
 */

export { useAgentConnectionStore } from "./agent-connection-store";
export type { AgentConnectionStore } from "./agent-connection-store";

export { useAgentSystemStore } from "./agent-system-store";
export type { AgentSystemStore } from "./agent-system-store";

export { useAgentPeripheralsStore } from "./agent-peripherals-store";
export type { AgentPeripheralsStore } from "./agent-peripherals-store";

export { useAgentScriptsStore } from "./agent-scripts-store";
export type { AgentScriptsStore } from "./agent-scripts-store";
