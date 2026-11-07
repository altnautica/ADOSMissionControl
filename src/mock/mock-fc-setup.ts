/**
 * @module mock/mock-fc-setup
 * @description Demo stand-in for a drone agent's flight-controller setup
 * engine (`/api/v1/fc-setup`), so the aircraft setup wizard and the
 * agent-routed calibration panels work without a drone. It plays an ArduPilot
 * quad-X through the ground wizard: detection and frame done, a six-pose
 * accelerometer calibration, a timed compass calibration, a motor check with
 * the yes/no question, battery and initial-tune inputs, the FC profile and the
 * ADOS Pilot introduction. The air wizard waits on the ground wizard; its
 * autotune runs roll and pitch, then yaw, with progress and live gains.
 * @license GPL-3.0-only
 */

import { fcSetupUrls, SetupRequestError, type SetupTransport } from "@/lib/fc-setup/client";
import { parseFrame } from "@/lib/fc-setup/parse";
import type { SetupFrame, StepState, Wizard } from "@/lib/fc-setup/types";

type Json = Record<string, unknown>;

const ACCEL_POSES = ["accel_level", "accel_left", "accel_right", "accel_nose_down", "accel_nose_up", "accel_back"];
const MOTORS = 4;

interface DemoState {
  wizards: Record<"ground" | "air", { state: Wizard["state"]; completed_at: string | null }>;
  steps: Record<string, Json>;
  order: Record<"ground" | "air", string[]>;
  snapshots: { file: string; ts: string }[];
  /** Stream subscribers; frames are wire-shaped, as the agent sends them. */
  listeners: Set<(frame: Json) => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const engines = new Map<string, DemoState>();

function action(id: string, style = "primary", confirm = "none"): Json {
  return { id, label_key: `setup.action.${id}`, style, confirm };
}

function baseStep(wizard: string, step: string, state: StepState = "pending"): Json {
  return {
    wizard,
    step,
    title_key: `setup.${step}.title`,
    body_key: `setup.${step}.body`,
    args: {},
    image: null,
    state,
    progress: null,
    live: {},
    actions: [],
    blockers: [],
    result: null,
  };
}

function create(): DemoState {
  const ground = ["detect", "frame", "accel", "level", "compass", "outputs", "battery", "initial_params", "ados_profile", "ados_intro"];
  const air = ["first_hover", "autotune", "verify"];
  const steps: Record<string, Json> = {};
  for (const s of ground) steps[`ground/${s}`] = baseStep("ground", s);
  for (const s of air) steps[`air/${s}`] = baseStep("air", s);
  Object.assign(steps["ground/detect"], {
    state: "done",
    result: { firmware: "ArduCopter 4.5.7", vehicle_class: "multirotor" },
  });
  Object.assign(steps["ground/frame"], {
    state: "done",
    image: "motor_order_quad_x",
    result: { frame_class: "QUAD", frame_type: "X" },
  });
  return {
    wizards: { ground: { state: "not_started", completed_at: null }, air: { state: "not_started", completed_at: null } },
    steps,
    order: { ground, air },
    snapshots: [],
    listeners: new Set(),
    timer: null,
  };
}

function engine(deviceId: string): DemoState {
  let e = engines.get(deviceId);
  if (!e) {
    e = create();
    engines.set(deviceId, e);
  }
  return e;
}

function wizardOf(e: DemoState, id: "ground" | "air"): Json {
  const groundDone = e.wizards.ground.state === "done";
  return {
    id,
    state: e.wizards[id].state,
    available: id === "ground" || groundDone,
    blockers: id === "air" && !groundDone ? ["setup.blocker.ground_required"] : [],
    completed_at: e.wizards[id].completed_at,
    steps: e.order[id].map((s) => e.steps[`${id}/${s}`]),
  };
}

function statusOf(e: DemoState): Json {
  const running = (["ground", "air"] as const).find((w) => e.wizards[w].state === "running");
  const current = running ? e.order[running].find((s) => e.steps[`${running}/${s}`].state !== "done" && e.steps[`${running}/${s}`].state !== "skipped") : null;
  const results: Record<string, Json> = {};
  for (const [k, s] of Object.entries(e.steps)) if (s.result) results[k.split("/")[1]] = s.result as Json;
  return {
    v: 1,
    uid: "demo-0042",
    firmware: "ArduCopter",
    firmware_version: "4.5.7",
    vehicle_class: "multirotor",
    running: running && current ? { wizard: running, step: current } : null,
    wizards: [wizardOf(e, "ground"), wizardOf(e, "air")],
    report: { date: e.wizards.ground.completed_at, firmware: "ArduCopter", firmware_version: "4.5.7", vehicle_class: "multirotor", steps: results, snapshots: e.snapshots },
  };
}

function emit(e: DemoState, step: Json): void {
  for (const fn of e.listeners) fn({ kind: "step", ts_ms: Date.now(), data: step });
}

function emitWizard(e: DemoState, id: "ground" | "air"): void {
  for (const fn of e.listeners) fn({ kind: "wizard", ts_ms: Date.now(), data: wizardOf(e, id) });
}

/** Put a step into its operator-facing state when it becomes current. */
function enter(e: DemoState, wizard: "ground" | "air", step: string): void {
  const s = e.steps[`${wizard}/${step}`];
  s.blockers = [];
  s.result = null;
  switch (step) {
    case "accel":
      Object.assign(s, { state: "waiting_user", image: ACCEL_POSES[0], progress: 0, live: { pose: 1 }, actions: [action("next_pose")] });
      break;
    case "level":
      Object.assign(s, { state: "waiting_user", image: "accel_level", actions: [action("start")] });
      break;
    case "compass":
      Object.assign(s, { state: "running", image: "compass_rotate", progress: 0, live: { compass_pct: 0, attempt: 1 }, actions: [action("cancel", "secondary")] });
      break;
    case "outputs":
      Object.assign(s, { state: "waiting_user", image: "motor_order_quad_x", live: {}, actions: [action("test", "primary", "hold_props_off")] });
      break;
    case "battery":
      Object.assign(s, { state: "waiting_user", actions: [action("apply")] });
      (s as Json).__inputs = { measured_v: { kind: "number", value: 16.8, min: 3, max: 60, step: 0.01, unit: "V", label_key: "setup.input.measured_v" } };
      break;
    case "initial_params":
      Object.assign(s, { state: "waiting_user", actions: [action("apply")] });
      (s as Json).__inputs = {
        prop_in: { kind: "number", value: 10, min: 2, max: 40, step: 0.5, unit: "in", label_key: "setup.input.prop_in" },
        cells: { kind: "number", value: 4, min: 1, max: 14, step: 1, unit: null, label_key: "setup.input.cells" },
      };
      break;
    case "ados_profile":
      Object.assign(s, { state: "waiting_user", actions: [action("apply")] });
      break;
    case "ados_intro":
      Object.assign(s, { state: "waiting_user", actions: [action("use_ados"), action("keep_fc", "secondary")] });
      break;
    case "autotune":
      Object.assign(s, {
        state: "waiting_user",
        body_key: "setup.autotune.body",
        progress: null,
        live: { wind_mps: 2.1, battery_pct: 92 },
        actions: [action("start"), action("abort", "danger", "hold")],
      });
      break;
    default:
      Object.assign(s, { state: "waiting_user", actions: [action("start")] });
  }
}

/** The step as the wire carries it (inputs folded into `args.inputs`). */
function wire(s: Json): Json {
  const { __inputs, ...rest } = s as Json & { __inputs?: Json };
  return __inputs ? { ...rest, args: { ...(rest.args as Json), inputs: __inputs } } : rest;
}

function finish(e: DemoState, wizard: "ground" | "air", step: string, result: Json): void {
  const s = e.steps[`${wizard}/${step}`];
  Object.assign(s, { state: "done", progress: null, actions: [], live: {}, result });
  delete (s as Json).__inputs;
  emit(e, wire(s));
  if (e.wizards[wizard].state !== "running") return;
  const next = e.order[wizard].find((id) => {
    const st = e.steps[`${wizard}/${id}`].state;
    return st !== "done" && st !== "skipped";
  });
  if (next) {
    enter(e, wizard, next);
    emit(e, wire(e.steps[`${wizard}/${next}`]));
  } else {
    e.wizards[wizard] = { state: "done", completed_at: new Date().toISOString() };
    emitWizard(e, wizard);
    // Completing the ground wizard unlocks the air wizard: push its new
    // availability too, as the agent's fresh view does.
    if (wizard === "ground") emitWizard(e, "air");
  }
}

function tick(e: DemoState): void {
  for (const [key, s] of Object.entries(e.steps)) {
    if (s.state !== "running") continue;
    if (s.step === "compass") {
      const p = Math.min(1, ((s.progress as number) ?? 0) + 0.1);
      s.progress = p;
      s.live = { compass_pct: Math.round(p * 100), attempt: 1 };
      if (p >= 1) finish(e, key.split("/")[0] as "ground", "compass", { compass_fitness: 9.4 });
      else emit(e, wire(s));
    } else if (s.step === "autotune") {
      // Roll and pitch over the first 60 %, yaw after; about 50 s in all.
      const p = Math.min(1, ((s.progress as number) ?? 0) + 0.01);
      const yaw = p >= 0.6;
      s.progress = p;
      s.body_key = yaw ? "setup.autotune.body.yaw" : "setup.autotune.body.roll_pitch";
      s.live = {
        autotune_axis: yaw ? "yaw" : p < 0.3 ? "roll" : "pitch",
        phase: "twitch",
        altitude_m: 8,
        wind_mps: 2.1,
        battery_pct: Math.round(92 - p * 30),
        last_text: yaw ? "AutoTune: Yaw" : "AutoTune: Saved gains",
      };
      if (p >= 1) {
        finish(e, "air", "autotune", {
          gains_before: { ATC_RAT_RLL_P: 0.135, ATC_RAT_PIT_P: 0.135, ATC_RAT_YAW_P: 0.18 },
          gains_after: { ATC_RAT_RLL_P: 0.112, ATC_RAT_PIT_P: 0.121, ATC_RAT_YAW_P: 0.24 },
        });
      } else emit(e, wire(s));
    }
  }
}

function doAction(e: DemoState, wizard: "ground" | "air", step: string, id: string, args: Json): Json {
  const s = e.steps[`${wizard}/${step}`];
  if (!s) throw new SetupRequestError(422, "setup.err.not_found", "unknown step");
  switch (`${step}:${id}`) {
    case "accel:next_pose": {
      const done = ((s.live as Json).pose as number) ?? 1;
      if (done >= ACCEL_POSES.length) {
        finish(e, wizard, step, { pass: true });
      } else {
        Object.assign(s, { image: ACCEL_POSES[done], progress: done / ACCEL_POSES.length, live: { pose: done + 1 } });
        emit(e, wire(s));
      }
      break;
    }
    case "level:start":
      finish(e, wizard, step, { pass: true });
      break;
    case "compass:cancel":
      Object.assign(s, { state: "failed", progress: null, actions: [action("retry")], blockers: ["setup.blocker.cancelled"] });
      emit(e, wire(s));
      break;
    case "compass:retry":
      enter(e, wizard, step);
      emit(e, wire(s));
      break;
    case "outputs:test":
      Object.assign(s, {
        live: { output_kind: "motor", output_index: 1, question_key: "setup.question.motor_position" },
        actions: [action("answer_yes"), action("answer_no", "secondary")],
      });
      emit(e, wire(s));
      break;
    case "outputs:answer_yes":
    case "outputs:answer_no": {
      const n = ((s.live as Json).output_index as number) ?? 1;
      if (n >= MOTORS) finish(e, wizard, step, { pass: true });
      else {
        s.live = { output_kind: "motor", output_index: n + 1, question_key: "setup.question.motor_position" };
        emit(e, wire(s));
      }
      break;
    }
    case "battery:apply":
      finish(e, wizard, step, { batt_volt_mult: Number((10.1 * ((args.measured_v as number) ?? 16.8) / 16.8).toFixed(3)) });
      break;
    case "initial_params:apply":
      finish(e, wizard, step, { pass: true });
      break;
    case "ados_profile:apply":
      e.snapshots = [...e.snapshots, { file: `${new Date().toISOString().replace(/[:.]/g, "-")}.param`, ts: new Date().toISOString() }];
      finish(e, wizard, step, { pass: true });
      break;
    case "ados_intro:use_ados":
    case "ados_intro:keep_fc":
      finish(e, wizard, step, { control_mode: id === "use_ados" ? "ados" : "fc_manual" });
      break;
    case "autotune:start":
      Object.assign(s, { state: "running", progress: 0, actions: [action("abort", "danger", "hold")] });
      emit(e, wire(s));
      break;
    case "autotune:abort":
      Object.assign(s, { state: "failed", progress: null, actions: [action("retry")], blockers: ["setup.abort.operator"] });
      emit(e, wire(s));
      break;
    case "autotune:retry":
      enter(e, wizard, step);
      emit(e, wire(s));
      break;
    default:
      finish(e, wizard, step, { pass: true });
  }
  return wire(s);
}

function parsePath(path: string): string[] {
  return path.slice(fcSetupUrls.status().length).split("/").filter(Boolean).map(decodeURIComponent);
}

const asWizard = (w: string): "ground" | "air" => {
  if (w !== "ground" && w !== "air") throw new SetupRequestError(422, "setup.err.not_found", "unknown wizard");
  return w;
};

/** The demo setup transport for one demo drone. */
export function demoSetupTransport(deviceId: string): SetupTransport {
  const e = engine(deviceId);
  return {
    get: async () => statusOf(e),
    post: async (path, body) => {
      const parts = parsePath(path);
      if (parts[0] === "revert") return { ok: true, restored: 42, snapshot: (body as Json)?.snapshot ?? null };
      const wizard = asWizard(parts[0]);
      if (parts[1] === "start") {
        e.wizards[wizard] = { state: "running", completed_at: null };
        const first = e.order[wizard].find((id) => e.steps[`${wizard}/${id}`].state !== "done");
        if (first) enter(e, wizard, first);
        return { ok: true, wizard: wizardOf(e, wizard) };
      }
      if (parts[1] === "abort") {
        e.wizards[wizard] = { state: "aborted", completed_at: null };
        return { ok: true, wizard: wizardOf(e, wizard) };
      }
      const step = parts[2];
      if (parts[1] !== "steps" || !step || !e.steps[`${wizard}/${step}`]) {
        throw new SetupRequestError(422, "setup.err.not_found", "unknown step");
      }
      if (parts[3] === "run") {
        if (wizard === "air" && e.wizards.ground.state !== "done") {
          throw new SetupRequestError(409, "setup.blocker.ground_required", "ground wizard first");
        }
        enter(e, wizard, step);
        return { ok: true, step: wire(e.steps[`${wizard}/${step}`]) };
      }
      if (parts[3] === "actions" && parts[4]) {
        const args = ((body as Json)?.args as Json) ?? {};
        return { ok: true, step: doAction(e, wizard, step, parts[4], args) };
      }
      throw new SetupRequestError(422, "setup.err.not_found", "unknown route");
    },
    openStream: (onFrame, onOpen) => {
      // The same parser the agent stream goes through.
      const listener = (raw: Json) => {
        const frame: SetupFrame | null = parseFrame(raw);
        if (frame) onFrame(frame);
      };
      e.listeners.add(listener);
      if (!e.timer) e.timer = setInterval(() => tick(e), 500);
      queueMicrotask(() => onOpen?.());
      return () => {
        e.listeners.delete(listener);
        if (e.listeners.size === 0 && e.timer) {
          clearInterval(e.timer);
          e.timer = null;
        }
      };
    },
  };
}

/** Test seam: drop every demo engine. */
export function resetDemoSetup(): void {
  for (const e of engines.values()) clearInterval(e.timer ?? undefined);
  engines.clear();
}

