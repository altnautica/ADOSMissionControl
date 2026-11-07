// Parsers for the FC setup wire: the setup step schema, the wizard objects and
// the `GET /api/v1/fc-setup` body, plus the stream frame reducer. Strict where
// a wrong guess is unsafe: an action with an unknown confirm kind or style is
// dropped rather than drawn as a plain tap, and a step without its identity or
// with an unknown state is rejected whole.

import {
  ACTION_STYLES,
  CONFIRM_KINDS,
  STEP_STATES,
  WIZARD_STATES,
  type ActionStyle,
  type ConfirmKind,
  type InputOption,
  type OutputQuestion,
  type SetupAction,
  type SetupFrame,
  type SetupReport,
  type SetupSnapshot,
  type SetupStatus,
  type SetupStep,
  type SetupValue,
  type StepInput,
  type StepState,
  type VehicleClass,
  type Wizard,
  type WizardState,
} from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isScalar(v: unknown): v is SetupValue {
  return v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function scalarMap(v: unknown, skip: (key: string) => boolean = () => false): Record<string, SetupValue> {
  const out: Record<string, SetupValue> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (!skip(k) && isScalar(val)) out[k] = val;
  }
  return out;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s !== "") : [];
}

export function parseAction(raw: unknown): SetupAction | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const label_key = str(raw.label_key);
  const style = oneOf<ActionStyle>(raw.style, ACTION_STYLES);
  const confirm = oneOf<ConfirmKind>(raw.confirm, CONFIRM_KINDS);
  if (!id || !label_key || !style || !confirm) return null;
  return { id, label_key, style, confirm };
}

export function parseInput(name: string, raw: unknown): StepInput | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw.kind, ["number", "enum", "bool"] as const);
  const label_key = str(raw.label_key);
  if (!kind || !label_key) return null;
  const value = isScalar(raw.value) ? raw.value : null;
  // An option is a bare value, or `{value, label_key}` naming its spec text.
  const options: InputOption[] = Array.isArray(raw.options)
    ? raw.options.flatMap((o): InputOption[] => {
        if (isScalar(o)) return [{ value: o, label_key: null }];
        if (isObj(o) && isScalar(o.value)) return [{ value: o.value, label_key: str(o.label_key) }];
        return [];
      })
    : [];
  if (kind === "enum" && options.length === 0) return null;
  return {
    name,
    kind,
    value,
    options,
    min: num(raw.min),
    max: num(raw.max),
    step: num(raw.step),
    unit: str(raw.unit),
    label_key,
  };
}

function parseInputs(raw: unknown): StepInput[] {
  if (!isObj(raw)) return [];
  const out: StepInput[] = [];
  for (const [name, spec] of Object.entries(raw)) {
    const input = parseInput(name, spec);
    if (input) out.push(input);
  }
  return out;
}

/** One setup step, or null when it lacks its identity or carries an unknown state. */
export function parseStep(raw: unknown): SetupStep | null {
  if (!isObj(raw)) return null;
  const wizard = str(raw.wizard);
  const step = str(raw.step);
  const title_key = str(raw.title_key);
  const state = oneOf<StepState>(raw.state, STEP_STATES);
  if (!wizard || !step || !title_key || !state) return null;
  const progress = num(raw.progress);
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(parseAction).filter((a): a is SetupAction => a !== null)
    : [];
  return {
    wizard,
    step,
    title_key,
    body_key: str(raw.body_key) ?? "",
    args: scalarMap(raw.args, (k) => k === "inputs"),
    inputs: isObj(raw.args) ? parseInputs(raw.args.inputs) : [],
    image: str(raw.image),
    state,
    progress: progress === null ? null : Math.min(1, Math.max(0, progress)),
    live: scalarMap(raw.live),
    actions,
    blockers: strings(raw.blockers),
    result: isObj(raw.result) ? raw.result : null,
  };
}

export function parseWizard(raw: unknown): Wizard | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const state = oneOf<WizardState>(raw.state, WIZARD_STATES);
  if (!id || !state) return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(parseStep).filter((s): s is SetupStep => s !== null)
    : [];
  return {
    id,
    state,
    available: raw.available !== false,
    blockers: strings(raw.blockers),
    completed_at: str(raw.completed_at),
    steps,
  };
}

function parseSnapshot(raw: unknown): SetupSnapshot | null {
  if (!isObj(raw)) return null;
  const file = str(raw.file);
  if (!file) return null;
  return { file, ts: str(raw.ts) ?? "" };
}

export function parseReport(raw: unknown): SetupReport | null {
  if (!isObj(raw)) return null;
  const steps: Record<string, Record<string, unknown>> = {};
  if (isObj(raw.steps)) {
    for (const [k, v] of Object.entries(raw.steps)) if (isObj(v)) steps[k] = v;
  }
  return {
    date: str(raw.date),
    firmware: str(raw.firmware),
    firmware_version: str(raw.firmware_version),
    vehicle_class: str(raw.vehicle_class),
    steps,
    snapshots: Array.isArray(raw.snapshots)
      ? raw.snapshots.map(parseSnapshot).filter((s): s is SetupSnapshot => s !== null)
      : [],
  };
}

/** The `GET /api/v1/fc-setup` body, or null when it is not one. */
export function parseStatus(raw: unknown): SetupStatus | null {
  if (!isObj(raw) || !Array.isArray(raw.wizards)) return null;
  const running =
    isObj(raw.running) && str(raw.running.wizard) && str(raw.running.step)
      ? { wizard: raw.running.wizard as string, step: raw.running.step as string }
      : null;
  return {
    uid: str(raw.uid),
    firmware: str(raw.firmware),
    firmware_version: str(raw.firmware_version),
    vehicle_class: oneOf<VehicleClass>(raw.vehicle_class, ["multirotor", "fixedwing", "vtol"]),
    running,
    wizards: raw.wizards.map(parseWizard).filter((w): w is Wizard => w !== null),
    report: parseReport(raw.report),
  };
}

/** One stream frame (text or already-decoded JSON), or null. */
export function parseFrame(raw: unknown): SetupFrame | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(value)) return null;
  const ts_ms = num(value.ts_ms) ?? 0;
  switch (value.kind) {
    case "step": {
      const data = parseStep(value.data);
      return data ? { kind: "step", ts_ms, data } : null;
    }
    case "wizard": {
      const data = parseWizard(value.data);
      return data ? { kind: "wizard", ts_ms, data } : null;
    }
    case "keepalive":
      return { kind: "keepalive", ts_ms };
    default:
      return null;
  }
}

/** Replace `step` inside its wizard. Unknown wizards or steps leave `status` as is. */
export function withStep(status: SetupStatus, step: SetupStep): SetupStatus {
  let hit = false;
  const wizards = status.wizards.map((w) => {
    if (w.id !== step.wizard) return w;
    const steps = w.steps.map((s) => {
      if (s.step !== step.step) return s;
      hit = true;
      return step;
    });
    return hit ? { ...w, steps } : w;
  });
  if (!hit) return status;
  const active = step.state === "running" || step.state === "waiting_user";
  const running = active
    ? { wizard: step.wizard, step: step.step }
    : status.running?.wizard === step.wizard && status.running.step === step.step
      ? null
      : status.running;
  return { ...status, wizards, running };
}

/** Replace (or add) a wizard. */
export function withWizard(status: SetupStatus, wizard: Wizard): SetupStatus {
  const known = status.wizards.some((w) => w.id === wizard.id);
  const wizards = known
    ? status.wizards.map((w) => (w.id === wizard.id ? wizard : w))
    : [...status.wizards, wizard];
  const running = wizard.state !== "running" && status.running?.wizard === wizard.id ? null : status.running;
  return { ...status, wizards, running };
}

/** Fold one stream frame into the status. */
export function applyFrame(status: SetupStatus, frame: SetupFrame): SetupStatus {
  switch (frame.kind) {
    case "step":
      return withStep(status, frame.data);
    case "wizard":
      return withWizard(status, frame.data);
    case "keepalive":
      return status;
  }
}

/** The step a wizard is on: the active one, else the first failed, else the
 *  first pending, else the last. Null for a wizard with no steps. */
export function currentStep(wizard: Wizard): SetupStep | null {
  const steps = wizard.steps;
  return (
    steps.find((s) => s.state === "running" || s.state === "waiting_user") ??
    steps.find((s) => s.state === "failed") ??
    steps.find((s) => s.state === "pending") ??
    steps[steps.length - 1] ??
    null
  );
}

/** Whether this FC still needs the `ground` wizard: an identified FC with no
 *  completed `ground` run. */
export function setupNeeded(status: SetupStatus | null): boolean {
  if (!status || !status.uid) return false;
  const ground = status.wizards.find((w) => w.id === "ground");
  return !ground || ground.state !== "done";
}

/** `step.live` keys that describe the outputs question, not a measured value. */
const OUTPUT_KEYS: Record<string, true> = {
  output_kind: true,
  output_index: true,
  question_key: true,
};

/** The live values to show as a table (the outputs-question keys left out). */
export function liveRows(step: SetupStep): Array<[string, SetupValue]> {
  return Object.entries(step.live).filter(([k]) => !OUTPUT_KEYS[k]);
}

/** The yes/no question the outputs step is asking about one motor or surface, or null. */
export function outputQuestion(step: SetupStep): OutputQuestion | null {
  const kind = oneOf(step.live.output_kind, ["motor", "surface"] as const);
  const index = num(step.live.output_index);
  const question_key = str(step.live.question_key);
  if (!kind || index === null || !question_key) return null;
  return { kind, index, question_key };
}

/** The current input values of a step, as the action body's `args`. */
export function inputArgs(inputs: StepInput[], edits: Record<string, SetupValue> = {}): Record<string, SetupValue> {
  const out: Record<string, SetupValue> = {};
  for (const i of inputs) out[i.name] = i.name in edits ? edits[i.name] : i.value;
  return out;
}
