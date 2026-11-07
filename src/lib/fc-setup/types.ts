// The FC setup wizard's wire types: the agent-driven setup engine's step schema
// and the `GET /api/v1/fc-setup` body. Every surface renders a step generically
// from these fields; nothing here knows what a given step does.

/** A step's lifecycle. */
export type StepState = "pending" | "running" | "waiting_user" | "done" | "failed" | "skipped";

export const STEP_STATES: readonly StepState[] = [
  "pending",
  "running",
  "waiting_user",
  "done",
  "failed",
  "skipped",
];

/** How an action button is drawn. */
export type ActionStyle = "primary" | "secondary" | "danger";

export const ACTION_STYLES: readonly ActionStyle[] = ["primary", "secondary", "danger"];

/** How an action is confirmed: a tap, a 1.5 s hold, or a hold whose label
 *  reads "Propellers are removed". */
export type ConfirmKind = "none" | "hold" | "hold_props_off";

export const CONFIRM_KINDS: readonly ConfirmKind[] = ["none", "hold", "hold_props_off"];

/** The hold time of the `hold` and `hold_props_off` confirms. */
export const HOLD_CONFIRM_MS = 1500;

export interface SetupAction {
  id: string;
  label_key: string;
  style: ActionStyle;
  confirm: ConfirmKind;
}

/** A scalar the engine reports or accepts. */
export type SetupValue = string | number | boolean | null;

/** One choice of an enum input: the value sent back, and its spec text key
 *  (null shows the value itself). */
export interface InputOption {
  value: SetupValue;
  label_key: string | null;
}

/** An operator input a step's actions carry (`step.args.inputs`). Every action
 *  of that step sends the current values as `{args:{<name>: value}}`. */
export interface StepInput {
  name: string;
  kind: "number" | "enum" | "bool";
  value: SetupValue;
  options: InputOption[];
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  label_key: string;
}

/** One wizard step. `args` holds interpolation values for the text keys;
 *  `inputs` is lifted out of `args.inputs`. */
export interface SetupStep {
  wizard: string;
  step: string;
  title_key: string;
  body_key: string;
  args: Record<string, SetupValue>;
  inputs: StepInput[];
  image: string | null;
  state: StepState;
  progress: number | null;
  live: Record<string, SetupValue>;
  actions: SetupAction[];
  blockers: string[];
  result: Record<string, unknown> | null;
}

export type WizardId = "ground" | "air";

export type WizardState = "not_started" | "running" | "done" | "failed" | "aborted";

export const WIZARD_STATES: readonly WizardState[] = ["not_started", "running", "done", "failed", "aborted"];

export interface Wizard {
  id: string;
  state: WizardState;
  /** False while a precondition is unmet (the `air` wizard needs `ground`). */
  available: boolean;
  blockers: string[];
  completed_at: string | null;
  steps: SetupStep[];
}

export interface SetupSnapshot {
  file: string;
  ts: string;
}

export interface SetupReport {
  date: string | null;
  firmware: string | null;
  firmware_version: string | null;
  vehicle_class: string | null;
  steps: Record<string, Record<string, unknown>>;
  snapshots: SetupSnapshot[];
}

export type VehicleClass = "multirotor" | "fixedwing" | "vtol";

/** The whole `GET /api/v1/fc-setup` body for the connected FC. */
export interface SetupStatus {
  /** The FC's AUTOPILOT_VERSION uid; null while no FC is identified. */
  uid: string | null;
  firmware: string | null;
  firmware_version: string | null;
  vehicle_class: VehicleClass | null;
  running: { wizard: string; step: string } | null;
  wizards: Wizard[];
  report: SetupReport | null;
}

/** One `WS /api/v1/fc-setup/stream` frame. */
export type SetupFrame =
  | { kind: "step"; ts_ms: number; data: SetupStep }
  | { kind: "wizard"; ts_ms: number; data: Wizard }
  | { kind: "keepalive"; ts_ms: number };

/** The yes/no question the outputs step is asking now (`step.live` keys
 *  `output_kind`, `output_index`, `question_key`); answered with the step's
 *  `answer_yes` / `answer_no` actions. */
export interface OutputQuestion {
  kind: "motor" | "surface";
  /** 1-based motor or surface index. */
  index: number;
  question_key: string;
}
