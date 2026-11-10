"use client";

/**
 * @module aircraft-setup/StepCard
 * @description One flight-controller setup step, drawn generically from the
 * agent's step schema: title and body (spec text keys with the step's args),
 * the pose / motor-order picture, a progress ring, the motor or surface
 * question, operator inputs, live values, blockers, the result, and the action
 * buttons with their confirm tier (tap, 1.5 s hold, or a hold that reads
 * "Propellers are removed"). The closing `ados_intro` step is the same data in
 * the "Meet ADOS Pilot" layout.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, CircleDashed, Gamepad2, Loader2, MinusCircle, Navigation, ShieldCheck, XCircle } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { inputArgs, liveRows, outputQuestion } from "@/lib/fc-setup/parse";
import { formatValue, optionText, setupImageUrl, setupLabel, setupText } from "@/lib/fc-setup/strings";
import { HOLD_CONFIRM_MS, type ActionStyle, type InputOption, type SetupAction, type SetupStep, type SetupValue, type StepInput, type StepState } from "@/lib/fc-setup/types";
import { cn } from "@/lib/utils";

/** The step id whose actions render as the "Meet ADOS Pilot" screen. */
export const ADOS_INTRO_STEP = "ados_intro";

const STYLE_CLASS: Record<ActionStyle, string> = {
  primary: "bg-accent-primary text-white hover:bg-accent-primary/90",
  secondary: "border border-border-default text-text-primary hover:bg-bg-tertiary",
  danger: "bg-status-error text-white hover:bg-status-error/90",
};

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-40";

export function StepStateIcon({ state }: { state: StepState }) {
  const cls = "h-4 w-4 shrink-0";
  switch (state) {
    case "done":
      return <CheckCircle2 className={cn(cls, "text-status-success")} aria-hidden />;
    case "failed":
      return <XCircle className={cn(cls, "text-status-error")} aria-hidden />;
    case "running":
      return <Loader2 className={cn(cls, "animate-spin text-accent-primary")} aria-hidden />;
    case "waiting_user":
      return <AlertTriangle className={cn(cls, "text-status-warning")} aria-hidden />;
    case "skipped":
      return <MinusCircle className={cn(cls, "text-text-tertiary")} aria-hidden />;
    default:
      return <CircleDashed className={cn(cls, "text-text-tertiary")} aria-hidden />;
  }
}

export function ProgressRing({ value, size = 56 }: { value: number | null; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="progressbar" aria-valuenow={p === null ? undefined : Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent-primary, #3a82ff)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={p === null ? `${c * 0.25} ${c}` : `${c * p} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={p === null ? "origin-center animate-spin" : undefined}
      />
      {p !== null && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-current text-[11px] font-semibold tabular-nums">
          {Math.round(p * 100)}%
        </text>
      )}
    </svg>
  );
}

export function SetupActionButton({
  action,
  step,
  disabled,
  onFire,
  className,
}: {
  action: SetupAction;
  step: SetupStep;
  disabled: boolean;
  onFire: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("aircraftSetup");
  const label = setupText(action.label_key, step.args);
  if (action.confirm === "none") {
    return (
      <button type="button" disabled={disabled} onClick={() => onFire(action.id)} className={cn(BUTTON, STYLE_CLASS[action.style], className)} data-testid={`setup-action-${action.id}`}>
        {label}
      </button>
    );
  }
  const propsOff = action.confirm === "hold_props_off";
  return (
    <HoldButton
      holdMs={HOLD_CONFIRM_MS}
      onFire={() => onFire(action.id)}
      disabled={disabled}
      title={propsOff ? t("holdTo", { action: label }) : setupText("setup.confirm.hold")}
      className={cn(BUTTON, STYLE_CLASS[action.style], className)}
      data-testid={`setup-action-${action.id}`}
    >
      {propsOff ? setupText("setup.confirm.hold_props_off") : label}
    </HoldButton>
  );
}

export interface StepCardProps {
  step: SetupStep;
  /** A request is in flight: every action waits. */
  busy: boolean;
  error: string | null;
  onAction: (step: SetupStep, actionId: string, args?: Record<string, SetupValue>) => void;
}

export function StepCard({ step, busy, error, onAction }: StepCardProps) {
  const t = useTranslations("aircraftSetup");
  const [edits, setEdits] = useState<Record<string, SetupValue>>({});
  const args = step.inputs.length ? inputArgs(step.inputs, edits) : undefined;
  const fire = (id: string) => onAction(step, id, args);

  if (step.step === ADOS_INTRO_STEP) {
    return <MeetAdosPilot step={step} busy={busy} error={error} onFire={fire} />;
  }

  const title = setupText(step.title_key, step.args);
  const image = setupImageUrl(step.image);
  const question = outputQuestion(step);
  const live = liveRows(step);
  const showRing = step.progress !== null || step.state === "running";
  const result = step.result ? Object.entries(step.result) : [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-secondary p-4" data-testid="setup-step-card" data-step={step.step} data-state={step.state}>
      <header className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <StepStateBadge state={step.state} />
      </header>

      {step.body_key && <p className="whitespace-pre-line text-sm text-text-secondary">{setupText(step.body_key, step.args)}</p>}

      {(image || showRing) && (
        <div className="flex flex-wrap items-center gap-4">
          {image && (
            // The spec draws these as light line art for a dark surface.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={title} className="h-44 w-auto max-w-full rounded-md bg-black/80 p-2" />
          )}
          {showRing && <ProgressRing value={step.progress} size={image ? 72 : 56} />}
        </div>
      )}

      {question && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-base font-medium text-text-primary" data-testid="setup-question">
          {setupText(question.question_key, { ...step.args, n: question.index, index: question.index, kind: question.kind })}
        </p>
      )}

      {step.inputs.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {step.inputs.map((input) => (
            <InputField
              key={input.name}
              input={input}
              value={input.name in edits ? edits[input.name] : input.value}
              onChange={(v) => setEdits((e) => ({ ...e, [input.name]: v }))}
            />
          ))}
        </div>
      )}

      {live.length > 0 && <ValueTable title={t("live")} group="live" rows={live} args={step.args} />}

      {step.blockers.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {step.blockers.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{setupText(b, step.args)}</span>
            </li>
          ))}
        </ul>
      )}

      {result.length > 0 && <ValueTable title={t("result")} group="result" rows={result} args={step.args} ok />}

      {error && (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      )}

      {step.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {step.actions.map((a) => (
            <SetupActionButton key={a.id} action={a} step={step} disabled={busy} onFire={fire} />
          ))}
        </div>
      )}
    </section>
  );
}

function ValueTable({
  title,
  group,
  rows,
  args,
  ok,
}: {
  title: string;
  group: "live" | "result";
  rows: Array<[string, unknown]>;
  args: Record<string, SetupValue>;
  ok?: boolean;
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2", ok ? "border-status-success/40 bg-status-success/5" : "border-border-default bg-bg-tertiary/40")}>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-text-secondary">{setupLabel(group, k, args)}</dt>
            <dd className="text-right font-mono tabular-nums text-text-primary">{formatValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function InputField({ input, value, onChange }: { input: StepInput; value: SetupValue; onChange: (v: SetupValue) => void }) {
  const label = setupText(input.label_key);
  const control = "min-h-12 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary";
  if (input.kind === "number") {
    return (
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        <span>
          {label}
          {input.unit ? ` (${input.unit})` : ""}
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={value === null ? "" : String(value)}
          min={input.min ?? undefined}
          max={input.max ?? undefined}
          step={input.step ?? "any"}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={cn(control, "font-mono tabular-nums")}
          data-testid={`setup-input-${input.name}`}
        />
      </label>
    );
  }
  const options: InputOption[] =
    input.kind === "bool"
      ? [
          { value: true, label_key: "setup.action.yes" },
          { value: false, label_key: "setup.action.no" },
        ]
      : input.options;
  return (
    <fieldset className="flex flex-col gap-1 text-xs text-text-secondary">
      <legend className="mb-1">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(({ value: o, label_key }) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={cn(control, o === value ? "border-accent-primary bg-accent-primary/15 text-accent-primary" : "hover:bg-bg-tertiary")}
          >
            {optionText(input.label_key, o, label_key)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const INTRO_ICONS = [Navigation, ShieldCheck, Gamepad2];

/** The step's state as an icon and its word, in a card header. */
function StepStateBadge({ state }: { state: StepState }) {
  const t = useTranslations("aircraftSetup");
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
      <StepStateIcon state={state} />
      {t(`stepState.${state}`)}
    </span>
  );
}

/** The `ados_intro` step: three lines on what ADOS flies, what the FC still
 *  does and how to take over, then the choice, recommended option first.
 *  The same layout and order as the agent's own wizard. */
function MeetAdosPilot({ step, busy, error, onFire }: { step: SetupStep; busy: boolean; error: string | null; onFire: (id: string) => void }) {
  const lines = step.body_key
    ? setupText(step.body_key, step.args)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const ordered = [...step.actions].sort((a, b) => Number(b.style === "primary") - Number(a.style === "primary"));
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-accent-primary/40 bg-bg-secondary p-6" data-testid="setup-step-card" data-step={step.step} data-state={step.state}>
      <header className="flex items-start justify-between gap-2">
        <h2 className="text-2xl font-semibold text-text-primary">{setupText(step.title_key, step.args)}</h2>
        <StepStateBadge state={step.state} />
      </header>
      <ol className="flex flex-col gap-3">
        {lines.map((line, i) => {
          const Icon = INTRO_ICONS[i % INTRO_ICONS.length];
          return (
            <li key={line} className="flex items-start gap-3 text-base text-text-primary">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-primary/15 text-accent-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="pt-1.5">{line}</span>
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {ordered.map((a) => (
          <SetupActionButton key={a.id} action={a} step={step} disabled={busy} onFire={onFire} className={a.style === "primary" ? "min-h-14 text-base" : undefined} />
        ))}
      </div>
    </section>
  );
}
