/**
 * @module mission-transfer
 * @description The mission store's transfers to and from a vehicle: the
 * upload (the plan, or a resume mission in its place, with the plan's transit
 * legs) and the download that replaces the plan with what the vehicle holds.
 * Also the plan settings every receipt hash of the open plan is taken with.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { DroneProtocol, MissionItem } from "@/lib/protocol/types";
import type { MissionStoreState } from "./mission-store";
import { droneSelection, selectedDroneProtocol } from "./drone-selection";
import { useTelemetryStore } from "./telemetry-store";
import { useUploadReceiptsStore } from "./upload-receipts-store";
import { withPlannerHistory } from "@/lib/planner-history";
import { flyingMissionRefusal } from "@/lib/mission/upload-guard";
// The pure mission ⇄ wire collapser: re-nests a downloaded flat item list into
// the waypoint model. The upload side goes through `mission-upload`, which also
// owns the receipt hash and the seq → waypoint mapping, so the three agree.
import { collapseFromItems, type HomeSlot } from "@/lib/mission/mission-expand";
import {
  missionUploadItems,
  missionContentHash,
  missionWireWaypoints,
  type MissionWireSettings,
} from "@/lib/mission-upload";
import { DEFAULT_PLAN_PROFILE, profileFromVehicleInfo } from "@/lib/mission/plan-profile";
import { droppedItemWarning } from "@/lib/mission-io-formats";
import { useNavStreamStore } from "@/stores/nav-stream-store";

type GetState = () => MissionStoreState;
type SetState = (partial: Partial<MissionStoreState>) => void;

/**
 * The home position written into ArduPilot's mission slot 0: the vehicle's
 * HOME_POSITION when this is the selected drone and one has been received,
 * else the first waypoint at 0 m. ArduPilot never stores an uploaded slot 0
 * (index zero is always home) and reads it back as its own AHRS home, so the
 * slot only has to hold a valid position for the upload to be accepted.
 */
export function uploadHome(protocol: DroneProtocol, waypoints: readonly Waypoint[]): HomeSlot {
  const isSelected = selectedDroneProtocol() === protocol;
  const home = isSelected ? useTelemetryStore.getState().homePosition.latest() : undefined;
  if (home) return { lat: home.lat, lon: home.lon, alt: home.alt };
  return { lat: waypoints[0]?.lat ?? 0, lon: waypoints[0]?.lon ?? 0, alt: 0 };
}

/**
 * The plan settings that change what an upload sends: the transit altitude,
 * resolved against the planned home's ground. Every receipt hash and seq
 * mapping of the open plan reads them through here.
 */
export function planWireSettings(
  state: Pick<MissionStoreState, "transitAltM" | "plannedHome">,
): MissionWireSettings {
  return { transitAltM: state.transitAltM, homeGroundElevation: state.plannedHome?.groundAmsl };
}

/** The drone id a protocol instance belongs to, if it is still managed. */
function droneIdOf(protocol: DroneProtocol): string | null {
  for (const [id, drone] of droneSelection().drones) {
    if (drone.protocol === protocol) return id;
  }
  return null;
}

/** The store's `uploadMission`; see its declaration for the contract. */
export async function uploadPlanMission(
  get: GetState,
  set: SetState,
  target?: DroneProtocol,
  opts?: { waypoints?: Waypoint[] },
): Promise<boolean> {
  // The target is explicit for callers scoped to a specific drone (the
  // plugin host, which must never fall back to the operator's selection);
  // it defaults to the selected drone for the planner's own Upload button.
  const protocol = target ?? selectedDroneProtocol();
  if (!protocol) return false;
  const droneId = droneIdOf(protocol);
  const state = get();
  // An override list (a resume mission) is sent in place of the plan.
  const override = opts?.waypoints;
  const planned = override ?? state.waypoints;
  if (planned.length === 0) return false;
  // The vehicle flies the plan with its transit legs.
  const wire = planWireSettings(state);
  const flown = missionWireWaypoints(planned, wire);

  // Never replace the mission under a vehicle that is flying it.
  const refusal = flyingMissionRefusal(droneId);
  if (refusal) {
    set({ uploadState: "error", uploadError: refusal });
    return false;
  }

  set({ uploadState: "uploading", uploadError: null });

  // Flatten the waypoint model (NAV waypoints + their attached actions) into
  // the FC's contiguous `seq` item list, with each frame-less waypoint taking
  // the mission's default frame, encoded for the autopilot and vehicle class
  // the target reports. ArduPilot keeps home in slot 0 and starts the
  // mission at slot 1, so the home slot is reserved there.
  const info = protocol.getVehicleInfo();
  const isArduPilot = info?.firmwareType.startsWith("ardupilot-") ?? false;
  let items: MissionItem[];
  try {
    items = missionUploadItems(
      flown,
      profileFromVehicleInfo(info) ?? DEFAULT_PLAN_PROFILE,
      isArduPilot ? uploadHome(protocol, flown) : undefined,
    );
  } catch (err) {
    // The plan cannot be encoded for this autopilot (a PX4 target and a
    // terrain-frame waypoint): nothing was sent, so the vehicle's mission
    // and any receipt for it are unchanged.
    set({ uploadState: "error", uploadError: err instanceof Error ? err.message : String(err) });
    return false;
  }
  // Hash what is being sent now: an edit made while the transfer runs must
  // not be vouched for by this upload's receipt. An override is not the
  // plan, so nothing vouches for it.
  const uploadedHash = override ? null : missionContentHash(planned, wire);
  const receipts = useUploadReceiptsStore.getState();

  let success = false;
  let failure: string | null = null;
  let opaqueId: number | undefined;
  // The agent's count of uploads it has seen from any client: theplan
  // identity rule trusts this receipt only while no other upload follows.
  const uploadsSeenBefore = droneId
    ? (useNavStreamStore.getState().byDrone[droneId]?.pilot?.data.mission?.uploadsSeen ?? undefined)
    : undefined;
  try {
    const result = await protocol.uploadMission(items);
    success = result.success;
    opaqueId = result.opaqueId;
    if (!success) failure = result.message || "The flight controller did not accept the mission";
  } catch (err) {
    failure = err instanceof Error && err.message ? err.message : "The mission transfer failed";
  }
  set({ uploadState: success ? "uploaded" : "error", uploadError: failure });
  if (droneId) {
    // A failed transfer may have left the FC with a partial or cleared
    // mission, so what it holds is no longer known. After an override the
    // vehicle no longer holds the plan either.
    if (success && uploadedHash !== null) {
      receipts.record("mission", {
        droneId,
        contentHash: uploadedHash,
        at: Date.now(),
        homeSlot: isArduPilot,
        total: items.length,
        ...(opaqueId !== undefined ? { opaqueId } : {}),
        ...(uploadsSeenBefore !== undefined ? { uploadsSeenBefore } : {}),
      });
    } else {
      receipts.clearKindForDrone("mission", droneId);
    }
  }
  return success;
}

/** The store's `downloadMission`; see its declaration for the contract. */
export async function downloadPlanMission(set: SetState): Promise<Waypoint[]> {
  const protocol = selectedDroneProtocol();
  if (!protocol) return [];

  set({ downloadState: "downloading", downloadWarnings: [], downloadError: null });

  try {
    const downloaded = await protocol.downloadMission();
    // ArduPilot's slot 0 is the home position, not a mission item. Jump
    // targets keep their absolute seq, which collapse resolves directly.
    const isArduPilot = protocol.getVehicleInfo()?.firmwareType.startsWith("ardupilot-") ?? false;
    const items = isArduPilot ? downloaded.filter((it) => it.seq !== 0) : downloaded;
    // The home slot anchors items the vehicle flies "from here" (RTL, 0,0
    // TAKEOFF/LAND/LOITER) when no waypoint precedes them.
    const homeItem = isArduPilot ? downloaded.find((it) => it.seq === 0) : undefined;
    const home = homeItem && (homeItem.x !== 0 || homeItem.y !== 0)
      ? { lat: homeItem.x / 1e7, lon: homeItem.y / 1e7 }
      : undefined;
    // Re-nest the flat FC item list back into NAV waypoints with attached
    // actions, resolving each DO_JUMP's target seq to its owning waypoint id.
    const downloadWarnings: string[] = [];
    const waypoints: Waypoint[] = collapseFromItems(items, (dropped) => {
      downloadWarnings.push(droppedItemWarning(dropped));
    }, home, profileFromVehicleInfo(protocol.getVehicleInfo())?.autopilot);
    // The vehicle holds no mission: report it and keep the open plan as it is.
    if (waypoints.length === 0) {
      set({ downloadState: "downloaded", downloadWarnings });
      return waypoints;
    }
    // Replacing the operator's plan with the FC's is a planner edit: one
    // undo step brings the local plan back. The vehicle's mission is taken
    // as it is: ArduPilot's home slot becomes the planned home (its ground
    // height is sampled locally, like any planned home), the downloaded
    // items already hold any transit legs, and the plan follows the vehicle
    // it came from.
    const settings = {
      plannedHome: home ?? null,
      vehicleProfile: null,
      transitAltM: null,
    } satisfies Partial<MissionStoreState>;
    withPlannerHistory(() => set({ waypoints, ...settings }));
    set({ downloadState: "downloaded", downloadWarnings });
    // The planner now shows what the FC holds, unless an item could not be
    // kept (then the two differ and nothing vouches for the plan).
    const droneId = droneIdOf(protocol);
    if (droneId && downloadWarnings.length === 0) {
      // The plan now held is the drone's: adopt its identity so the plan
      // identity check reads "match" until another upload replaces it.
      const agentMission = useNavStreamStore.getState().byDrone[droneId]?.pilot?.data.mission;
      useUploadReceiptsStore.getState().record("mission", {
        droneId,
        contentHash: missionContentHash(waypoints, planWireSettings(settings)),
        at: Date.now(),
        homeSlot: isArduPilot,
        ...(agentMission?.id ? { opaqueId: agentMission.id } : {}),
        // MISSION_CURRENT's total excludes ArduPilot's home slot; the receipt
        // counts items as the upload path does, home included.
        ...(agentMission?.total != null ? { total: agentMission.total + (isArduPilot ? 1 : 0) } : {}),
        ...(agentMission?.uploadsSeen != null ? { uploadsSeenBefore: agentMission.uploadsSeen } : {}),
      });
    }
    return waypoints;
  } catch (err) {
    set({
      downloadState: "error",
      downloadError: err instanceof Error && err.message ? err.message : "The mission transfer failed",
    });
    return [];
  }
}
