/**
 * @module hooks/use-shell-modals-allowed
 * @description Whether the shell may open its own modals (welcome, disclaimer,
 * What's New). Never while a flight screen is mounted or any connected vehicle
 * reports armed: a modal must not cover a cockpit or STOP. Callers keep their
 * modal queued and open it once this turns true.
 * @license GPL-3.0-only
 */

import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";

export function useShellModalsAllowed(): boolean {
  const flightScreen = useFlightScreenStore((s) => s.mounted > 0);
  const anyArmed = useNodeRegistryStore((s) =>
    Object.values(s.nodes).some((n) => n.fc.armState === "armed"),
  );
  return !flightScreen && !anyArmed;
}
