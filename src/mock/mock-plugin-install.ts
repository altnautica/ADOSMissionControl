/**
 * @module MockPluginInstall
 * @description Demo-mode stand-in for the plugin install transports.
 * Skips the actual upload and resolves with a fake job id after ~1 s
 * so the dialog UX can be exercised without an agent or a Convex
 * backend.
 *
 * Only loaded inside `PluginInstallDialog` under an `isDemoMode()`
 * guard. Never reached in production code paths.
 *
 * @license GPL-3.0-only
 */

import type {
  InstallKickoffResult,
  InstallTransport,
  TransportContext,
} from "@/components/plugins/transports/types";

const SIMULATED_LATENCY_MS = 1_000;

/**
 * Simulate a successful install on the chosen transport. The dialog
 * closes immediately on resolve; the progress toast renders its own
 * mocked stage progression.
 */
export async function mockPluginInstall(
  transport: InstallTransport,
  ctx: TransportContext,
): Promise<InstallKickoffResult> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));
  return {
    transport,
    jobId: `demo-${Date.now().toString(36)}`,
    pluginId: ctx.manifest.pluginId,
    pluginName: ctx.manifest.name,
    deviceId: ctx.deviceId,
    enabledOnAgent: transport === "lan",
    notice:
      transport === "cloud" ? "Demo mode: simulated cloud relay." : undefined,
  };
}
