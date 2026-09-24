/**
 * @module AgentSchemas
 * @description zod schemas for the ADOS Drone Agent REST API boundary.
 * Used as optional runtime validators on client.request() calls so the
 * GCS catches shape drift instead of crashing deep inside a store.
 *
 * Schemas are intentionally permissive at the seam: unknown fields pass
 * through, optional fields are explicitly optional, and unions accept the
 * older legacy shapes the agent has shipped over time.
 *
 * This file is a thin barrel. The per-domain schemas live under
 * `schemas/` (heartbeat, capabilities, navigation, setup, pairing,
 * peripherals, meshnet, command, battery). Callers continue to import from
 * `@/lib/agent/schemas` unchanged.
 *
 * @license GPL-3.0-only
 */

export * from "./schemas/heartbeat";
export * from "./schemas/capabilities";
export * from "./schemas/navigation";
export * from "./schemas/setup";
export * from "./schemas/pairing";
export * from "./schemas/peripherals";
export * from "./schemas/meshnet";
export * from "./schemas/command";
export * from "./schemas/battery";
