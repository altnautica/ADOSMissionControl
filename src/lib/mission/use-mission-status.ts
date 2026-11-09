/**
 * @module mission/use-mission-status
 * @description The mission status of one drone for any surface: the drone's
 * own value from the `pilot` nav kind when the agent publishes one, else the
 * direct link's computation.
 * @license GPL-3.0-only
 */

import type { MissionState } from "@/lib/hud/cockpit-frames";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { selectMissionStatus, useMissionStateStore, type MissionStatus } from "./mission-state";

/** The agent's parsed `mission` object as a status, or null when it names no state. */
export function fromAgentMission(m: MissionState | null | undefined): MissionStatus | null {
  if (!m || !m.state) return null;
  return {
    state: m.state,
    seq: m.seq ?? 0,
    total: m.total ?? 0,
    itemReached: m.itemReached,
    id: m.id,
    source: m.source ?? "fallback",
    ageMs: m.ageMs ?? 0,
    landingSeq: m.landingSeq,
  };
}

/** A drone's agent-computed mission object, from the pilot kind. */
function agentMission(droneId: string): MissionState | null {
  return useNavStreamStore.getState().byDrone[droneId]?.pilot?.data.mission ?? null;
}

/** Non-reactive read for command paths (skills, upload guards). */
export function readMissionStatus(droneId: string | null | undefined): MissionStatus | null {
  if (!droneId) return null;
  return selectMissionStatus(
    fromAgentMission(agentMission(droneId)),
    useMissionStateStore.getState().status[droneId],
  );
}

/** Reactive mission status for a drone. */
export function useMissionStatus(droneId: string | null | undefined): MissionStatus | null {
  const agent = useNavStreamStore((s) =>
    droneId ? (s.byDrone[droneId]?.pilot?.data.mission ?? null) : null,
  );
  const direct = useMissionStateStore((s) => (droneId ? s.status[droneId] : undefined));
  return selectMissionStatus(fromAgentMission(agent), direct);
}
