/**
 * The subscription wiring that keeps the selected drone's skill states fresh,
 * and feeds the flight facts the safety built-ins gate on (the modes the
 * drone is seen flying, its flight controller's landed state, a drone going
 * away).
 *
 * @module skills/subscriptions
 * @license GPL-3.0-only
 */

import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { usePluginSkillHostStore } from "@/lib/skills/plugin-skill-host-store";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { setCooldownTick } from "./cooldown";
import { forgetDrone, noteFcLandedState, observeFlightMode, vehicleLanded } from "./flight-facts";
import { isSkillLinkFresh, useSkillRegistry } from "./registry";

/** How often the FC heartbeat age is sampled for link freshness (ms). */
const LINK_FRESH_POLL_MS = 500;

/** How often the pilot state's and the landed state's ages are sampled (ms). */
const FACT_FRESH_POLL_MS = 1000;

let teardown: (() => void) | null = null;

/**
 * Subscribe the stores that drive skill state (arm, mode, system status and
 * connection, the selected drone, its pilot state, FC link freshness, the
 * pilot's and the landed state's freshness, checklist readiness, the
 * Follow-Me behavior store, cooldown ends) and recompute the selected drone's
 * state on any change, coalesced to animation-frame cadence so a 10 Hz
 * telemetry stream does not thrash the bar. Each managed drone's
 * EXTENDED_SYS_STATE feeds its landed state, and a drone that goes away is
 * forgotten. Idempotent; returns the teardown, which stops all of it.
 */
export function initSkillSubscriptions(): () => void {
  if (teardown) return teardown;

  const stops: Array<() => void> = [];
  let frame: number | null = null;
  const schedule = () => {
    if (frame !== null) return;
    const run = () => {
      frame = null;
      useSkillRegistry.getState().recomputeSelected();
    };
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(run);
    } else {
      // Non-browser/test environment: recompute synchronously.
      run();
    }
  };

  // The cooldown/charge clock recomputes the bar once at each window end and
  // recharge boundary; the sweep in between animates in CSS.
  setCooldownTick(schedule);
  stops.push(() => setCooldownTick(() => undefined));

  // Link freshness. A heartbeat that stops arriving changes no store field, so
  // without a clock the bar would keep offering commands over a dead link. The
  // ticker samples the selected drone's heartbeat age and recomputes only when
  // freshness (or the selection it was sampled for) flips.
  let linkDroneId: string | null = null;
  let linkFresh: boolean | null = null;
  const linkTimer = setInterval(() => {
    const droneId = useDroneManager.getState().selectedDroneId;
    const fresh = isSkillLinkFresh(useDroneStore.getState().lastHeartbeat, Date.now());
    if (droneId === linkDroneId && fresh === linkFresh) return;
    linkDroneId = droneId;
    linkFresh = fresh;
    schedule();
  }, LINK_FRESH_POLL_MS);
  stops.push(() => clearInterval(linkTimer));

  // Pilot and landed freshness. A pilot state that stops arriving, or a
  // landed state that ages out, changes no store field either: Pause and
  // Disarm read them, so the ticker recomputes when either flips.
  let factKey: string | null = null;
  const factTimer = setInterval(() => {
    const droneId = useDroneManager.getState().selectedDroneId;
    const now = Date.now();
    const at = droneId ? useNavStreamStore.getState().byDrone[droneId]?.pilot?.receivedAt : undefined;
    const key = `${droneId}|${pilotFresh(at, now)}|${droneId ? vehicleLanded(droneId, now) : null}`;
    if (key === factKey) return;
    factKey = key;
    schedule();
  }, FACT_FRESH_POLL_MS);
  stops.push(() => clearInterval(factTimer));

  // Checklist readiness gates arm/take-off; recompute when it flips for the
  // selected drone.
  let checklistReady: boolean | null = null;
  stops.push(
    useChecklistStore.subscribe((state) => {
      const droneId = useDroneManager.getState().selectedDroneId;
      const ready = droneId ? state.isReadyToArm(droneId) : false;
      if (ready === checklistReady) return;
      checklistReady = ready;
      schedule();
    }),
  );

  stops.push(
    useDroneStore.subscribe((next, prev) => {
      if (next.flightMode !== prev.flightMode) {
        // The selected drone's heartbeat: a commanded mode is seen, or ends.
        const droneId = useDroneManager.getState().selectedDroneId;
        if (droneId) observeFlightMode(droneId, next.flightMode);
      }
      if (
        next.armState !== prev.armState ||
        next.flightMode !== prev.flightMode ||
        next.systemStatus !== prev.systemStatus ||
        next.connectionState !== prev.connectionState
      ) {
        schedule();
      }
    }),
  );

  // The selected drone's pilot state (failsafe, landed, control) drives
  // Pause, Disarm and the routes.
  stops.push(
    useNavStreamStore.subscribe((next, prev) => {
      const droneId = useDroneManager.getState().selectedDroneId;
      if (droneId && next.byDrone[droneId]?.pilot !== prev.byDrone[droneId]?.pilot) schedule();
    }),
  );

  // Each managed drone's flight controller reports its landed state; a drone
  // that goes away (removed or disconnected) takes its facts with it.
  const landedSubs = new Map<string, () => void>();
  const syncDrones = (drones: ReadonlyMap<string, ManagedDrone>) => {
    for (const [id, unsub] of landedSubs) {
      if (drones.has(id)) continue;
      unsub();
      landedSubs.delete(id);
      forgetDrone(id);
    }
    for (const [id, drone] of drones) {
      if (landedSubs.has(id)) continue;
      const unsub = drone.protocol.onExtendedSysState?.((d) => noteFcLandedState(id, d.landedState, d.timestamp));
      landedSubs.set(id, unsub ?? (() => undefined));
    }
  };
  syncDrones(useDroneManager.getState().drones);

  // Selection lives in the drone manager, so it needs its own subscription
  // rather than riding the flight-state store.
  stops.push(
    useDroneManager.subscribe((next, prev) => {
      if (next.drones !== prev.drones) syncDrones(next.drones);
      if (next.selectedDroneId !== prev.selectedDroneId) schedule();
    }),
  );
  stops.push(() => {
    for (const unsub of landedSubs.values()) unsub();
    landedSubs.clear();
  });

  stops.push(
    useFollowMeStore.subscribe((next, prev) => {
      if (next.isActive !== prev.isActive || next.isPaused !== prev.isPaused) {
        schedule();
      }
    }),
  );

  // A plugin's own state report (active, idle, disabled, and when it was last
  // seen) is what its picker entry shows.
  stops.push(
    usePluginSkillHostStore.subscribe((next, prev) => {
      if (next.states !== prev.states) schedule();
    }),
  );

  stops.push(() => {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null;
  });

  teardown = () => {
    for (const stop of stops) stop();
    teardown = null;
  };
  return teardown;
}
