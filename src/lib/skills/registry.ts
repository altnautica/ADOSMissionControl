/**
 * The skill registry: a Zustand store holding every registered skill plus a
 * per-drone cache of each skill's live state. Built-ins register at startup;
 * plugin skills register and unregister as their per-drone slot mounts. The
 * Skill Bar and the binding UI read from here; the subscription layer in
 * `index.ts` keeps the selected drone's state cache fresh.
 *
 * State is derived from real inputs (arm state, flight mode, firmware
 * capabilities, the behavior store) and never set optimistically on a press,
 * so the bar shows the true state of the vehicle.
 *
 * @module skills/registry
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  Skill,
  SkillState,
  SkillContext,
  ConfirmPolicy,
} from "./types";
import type { ProtocolCapabilities } from "@/lib/protocol/types";
import { autonomousNavFromCapabilities } from "./autonomous-nav";
import { getCooldownState, getChargeCount } from "./cooldown";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useChecklistStore } from "@/stores/checklist-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";

const IDLE_STATE: SkillState = { kind: "idle" };

/**
 * Best-effort toast bridge. The dispatcher injects the live toast callback at
 * mount via {@link setSkillNotifier}; until then notifications are dropped so a
 * non-React caller (the registry's own teardown) never crashes.
 */
let notifier: SkillContext["notify"] = () => {};

/** Wire the live toast callback (called once from the dispatcher host). */
export function setSkillNotifier(fn: SkillContext["notify"]): void {
  notifier = fn;
}

/**
 * Emit through the live toast bridge. Exposed so a context built outside this
 * module routes its feedback through the same host instead of standing up a
 * second notification path.
 */
export const notifySkill: SkillContext["notify"] = (message, status) => {
  notifier(message, status);
};

/**
 * Build the per-drone SkillContext from the live stores. This is the single
 * seam every skill method sees; `index.ts` re-exports it as
 * `buildSkillContext`. The protocol, arm state, mode, firmware modes, and
 * checklist readiness are all read at call time so a skill always sees the
 * current vehicle.
 */
export function buildSkillContextFor(droneId: string): SkillContext {
  const drone = useDroneManager.getState().getSelectedDrone();
  // The selected drone is the one the context targets; guard the id matches so
  // a stale droneId can't read another drone's protocol.
  const protocol =
    drone && drone.id === droneId ? drone.protocol : null;
  const live = protocol && protocol.isConnected ? protocol : null;

  const droneState = useDroneStore.getState();
  const handler = live?.getFirmwareHandler() ?? null;
  const availableModes = handler?.getAvailableModes() ?? [];

  const supports = (cap: keyof ProtocolCapabilities): boolean => {
    if (!live) return false;
    return Boolean(live.getCapabilities()?.[cap]);
  };

  // Only a live handshake proves whether the firmware can do autonomous nav.
  // With no live protocol the capability is genuinely unknown, not "no" — so a
  // non-connected node's RTL / Land / Takeoff are kept (shown disabled-no-link)
  // rather than the blanket-false `supports` above hiding them.
  const autonomousNav: SkillContext["autonomousNav"] = live
    ? autonomousNavFromCapabilities(live.getCapabilities())
    : "unknown";

  return {
    droneId,
    protocol: live,
    armState: droneState.armState,
    flightMode: droneState.flightMode,
    availableModes,
    previousMode: droneState.previousMode,
    supports,
    autonomousNav,
    checklistReady: useChecklistStore.getState().isReadyToArm(),
    confirm: (policy: ConfirmPolicy) =>
      useSkillConfirmStore.getState().request(policy),
    notify: (message, status) => notifier(message, status),
  };
}

/**
 * Canonical bar ordering. Skills sort by category bucket, then by their
 * registration order within the bucket. Safety sits last so the high-
 * consequence actions are visually separated.
 */
const CATEGORY_ORDER: Record<Skill["category"], number> = {
  flight: 0,
  behavior: 1,
  camera: 2,
  safety: 3,
};

export interface SkillRegistryState {
  /** All registered skills, keyed by skill id. */
  skills: Map<string, Skill>;
  /** Live per-drone state cache: droneId -> (skillId -> state). */
  states: Map<string, Map<string, SkillState>>;
  /** Registration order, used as a stable tie-breaker inside a category. */
  _order: Map<string, number>;
  /** Monotonic registration counter. */
  _seq: number;

  register: (skill: Skill) => void;
  unregister: (skillId: string) => void;
  resolveForDrone: (droneId: string) => Skill[];
  getState: (droneId: string, skillId: string) => SkillState;
  recomputeSelected: () => void;
}

export const useSkillRegistry = create<SkillRegistryState>((set, get) => ({
  skills: new Map(),
  states: new Map(),
  _order: new Map(),
  _seq: 0,

  register: (skill) => {
    set((s) => {
      const skills = new Map(s.skills);
      skills.set(skill.id, skill);
      const order = new Map(s._order);
      // Preserve the original slot if a skill re-registers (plugin re-mount).
      const seq = order.has(skill.id) ? s._seq : s._seq + 1;
      if (!order.has(skill.id)) order.set(skill.id, seq);
      return { skills, _order: order, _seq: seq };
    });
    get().recomputeSelected();
  },

  unregister: (skillId) => {
    const { skills, states } = get();
    const skill = skills.get(skillId);
    if (!skill) return;

    // Clean-stop the skill on every drone where it is active before dropping it.
    if (skill.toggle && skill.deactivate) {
      for (const [droneId, perDrone] of states) {
        if (perDrone.get(skillId)?.kind === "active") {
          const ctx = buildSkillContextFor(droneId);
          void skill.deactivate(ctx).catch(() => {
            // Forced teardown is best-effort; a failed stop must not wedge the
            // registry. The behavior's own store reconciles the truth.
          });
        }
      }
    }

    set((s) => {
      const nextSkills = new Map(s.skills);
      nextSkills.delete(skillId);
      const nextStates = new Map<string, Map<string, SkillState>>();
      for (const [droneId, perDrone] of s.states) {
        const copy = new Map(perDrone);
        copy.delete(skillId);
        nextStates.set(droneId, copy);
      }
      const order = new Map(s._order);
      order.delete(skillId);
      return { skills: nextSkills, states: nextStates, _order: order };
    });
  },

  resolveForDrone: (droneId) => {
    const { skills, _order } = get();
    const ctx = buildSkillContextFor(droneId);

    const visible: Skill[] = [];
    for (const skill of skills.values()) {
      // Plugin skills appear only for drones that have the plugin installed.
      if (skill.source === "plugin" && !isPluginInstalledFor(skill, droneId)) {
        continue;
      }
      // A skill that needs autonomous nav is filtered out only when the
      // firmware is KNOWN to lack it (an acro flight controller), driven off the
      // node's real capability. A node whose capability is merely unknown — one
      // the GCS holds no live handshake to, whose `supports` reads blanket-false
      // — keeps the skill (shown disabled-with-reason), so a node that can
      // actually return home is never hidden just because it is not connected.
      if (skill.requiresAutonomousNav && ctx.autonomousNav === "unsupported") {
        continue;
      }
      visible.push(skill);
    }

    visible.sort((a, b) => {
      const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (cat !== 0) return cat;
      return (_order.get(a.id) ?? 0) - (_order.get(b.id) ?? 0);
    });
    return visible;
  },

  getState: (droneId, skillId) => {
    return get().states.get(droneId)?.get(skillId) ?? IDLE_STATE;
  },

  recomputeSelected: () => {
    const droneId = useDroneStore.getState().selectedId;
    if (!droneId) return;

    const { skills } = get();
    const ctx = buildSkillContextFor(droneId);
    const next = new Map<string, SkillState>();
    for (const skill of skills.values()) {
      let state: SkillState;
      try {
        state = skill.getState(ctx);
      } catch {
        // A misbehaving plugin getState must never crash the bar; fall back to
        // a benign disabled state rather than tear down the recompute.
        state = { kind: "disabled", reason: "skills.reason.stateError" };
      }
      next.set(skill.id, mergeDispatcherState(droneId, skill, state));
    }

    set((s) => {
      const states = new Map(s.states);
      states.set(droneId, next);
      return { states };
    });
  },
}));

/**
 * Merge the dispatcher's out-of-band cooldown window + charge budget into a
 * skill's pure computed state. The cooldown projection comes from a real
 * wall-clock window (1->0 sweep) and overrides only an `idle` state — a
 * disabled skill stays disabled (the reason matters more), and a toggle that is
 * `active` is never shown cooling down (HUD-honesty: an active toggle is not in
 * a one-shot lockout). The charge count is surfaced as the badge on whatever
 * the resulting state is.
 */
function mergeDispatcherState(
  droneId: string,
  skill: Skill,
  computed: SkillState,
): SkillState {
  let state = computed;

  const cooldown = getCooldownState(droneId, skill.id);
  if (cooldown && state.kind === "idle") {
    state = { ...state, kind: "cooldown", progress: cooldown.progress };
  }

  const charge = getChargeCount(droneId, skill);
  if (charge) {
    // The badge mirrors the real remaining-charge count; never optimistic.
    state = { ...state, badge: String(charge.current) };
  }

  return state;
}

/**
 * Whether a plugin skill's contributing plugin is installed on a given drone.
 * The plugin host registers a plugin skill only for drones where the plugin is
 * installed (per-drone install model), so a registered plugin skill is, by
 * construction, available for that drone. This guard is a defensive second
 * check for the resolve path and a seam for a future cross-drone registry.
 */
function isPluginInstalledFor(_skill: Skill, _droneId: string): boolean {
  // Plugin skills are registered per-drone by the host; presence in the
  // registry is the install signal in v1. Returns true so a registered plugin
  // skill resolves for the drone it was registered against.
  return true;
}

export type { SkillContext };
