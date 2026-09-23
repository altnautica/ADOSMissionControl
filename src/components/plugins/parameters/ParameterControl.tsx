"use client";

/**
 * @module plugins/parameters/ParameterControl
 * @description A single schema-driven plugin-parameter control. Picks the
 * rendered widget from the parameter schema + ui hint via `inferWidget`, then
 * renders a dark-first input that commits a validated, clamped value through
 * the `onCommit` callback. The control is a presentation primitive: it never
 * writes to an agent itself; the parent panel routes the committed value by
 * binding.
 *
 * Number/range commits clamp to the schema bounds + quantize to the step and
 * reject non-finite input. String commits validate against the schema pattern.
 * Enum commits map the chosen string option back to the original typed value.
 * The model / model_upload widgets render the board-filtered ModelPicker
 * (compact mode) bound to the engine's active detector — selecting or
 * uploading a model writes the engine-wide `vision.detector` (every vision
 * consumer shares one detector), so the picker owns that write directly and
 * does not route through `onCommit`.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { BitmaskEditor } from "@/components/ui/bitmask-editor";
import { summarizeBitmask } from "@/lib/protocol/param-display";
import {
  clampValue,
  inferWidget,
  validateValue,
} from "@/lib/plugins/parameters/schema";
import type { ParsedParameterContribution } from "@/lib/plugins/parameters/parse";
import { ModelPicker } from "@/components/vision/ModelPicker";

type ParameterValue = string | number | boolean;

interface ParameterControlProps {
  param: ParsedParameterContribution;
  value: ParameterValue;
  disabled?: boolean;
  onCommit: (value: ParameterValue) => void;
  /** Drone whose engine detector a model / model_upload widget manages. The
   * picker routes its engine-wide write to this drone's agent (Rule 39).
   * Required for the model widgets; ignored by all other widgets. */
  droneId?: string;
}

/** Shared input styling matching the repo's text-input primitive. */
const FIELD_INPUT_CLASS =
  "w-full h-8 px-2 bg-bg-tertiary border text-sm font-mono text-text-primary " +
  "placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary " +
  "transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const HELP_CLASS = "text-[10px] text-text-tertiary leading-tight";

/** Label + help + error wrapper shared by the text-like widgets. */
function FieldShell({
  htmlFor,
  label,
  help,
  error,
  children,
}: {
  htmlFor?: string;
  label: string;
  help?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-text-secondary">
        {label}
      </label>
      {children}
      {help ? <span className={HELP_CLASS}>{help}</span> : null}
      {error ? (
        <span className="text-[10px] text-status-error leading-tight">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ParameterControl({
  param,
  value,
  disabled = false,
  onCommit,
  droneId,
}: ParameterControlProps) {
  const { schema, ui } = param;
  const widget = inferWidget(schema, ui);
  const label = ui?.label ?? param.key;
  const help = ui?.help;
  const inputId = useId();

  // Local editing state for the free-text widgets (number/string) and the
  // range slider; synced back to `value` whenever the committed value changes
  // upstream, including a parent rollback after a rejected write.
  const [text, setText] = useState<string>(String(value));
  const [rangeVal, setRangeVal] = useState<number>(
    typeof value === "number" ? value : Number(value) || 0,
  );
  const [error, setError] = useState<string | null>(null);
  const [bitmaskOpen, setBitmaskOpen] = useState(false);

  useEffect(() => {
    setText(String(value));
    setRangeVal(typeof value === "number" ? value : Number(value) || 0);
    setError(null);
  }, [value]);

  const commitNumber = useCallback(
    (raw: string) => {
      const parsed = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(parsed)) {
        setError("Enter a number");
        setText(String(value));
        return;
      }
      const clamped = clampValue(schema, parsed);
      if (typeof clamped !== "number") {
        setError("Invalid value");
        setText(String(value));
        return;
      }
      const check = validateValue(schema, clamped);
      if (!check.ok) {
        setError(check.error ?? "Invalid value");
        setText(String(value));
        return;
      }
      setError(null);
      setText(String(clamped));
      // Focus in and out without an edit must not write the shown value
      // (which may be an unconfirmed default) over the drone's setting.
      if (clamped === value) return;
      onCommit(clamped);
    },
    [schema, value, onCommit],
  );

  const commitString = useCallback(
    (raw: string) => {
      const check = validateValue(schema, raw);
      if (!check.ok) {
        setError(check.error ?? "Invalid value");
        return;
      }
      setError(null);
      if (raw === value) return;
      onCommit(raw);
    },
    [schema, value, onCommit],
  );

  const commitRange = useCallback(() => {
    const clamped = clampValue(schema, rangeVal);
    if (typeof clamped !== "number") return;
    if (!validateValue(schema, clamped).ok) return;
    if (clamped === value) return;
    onCommit(clamped);
  }, [schema, rangeVal, value, onCommit]);

  // The active detector is engine-wide: a model / model_upload parameter binds
  // to `engine.detector`, not the plugin's own config. Render the board-filtered
  // ModelPicker (compact) so the operator can pick or upload a model right here;
  // it writes the engine-wide detector itself and reports the new active model
  // back through onCommit so the panel's form state reflects it.
  if (widget === "model" || widget === "model_upload") {
    if (!droneId) {
      // No drone context (e.g. a detached preview) — fall back to a read-only
      // affordance rather than rendering a picker with nowhere to write.
      const shown =
        value !== "" && value !== undefined && value !== null
          ? String(value)
          : "—";
      return (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">{label}</span>
          <div className="flex min-h-8 w-full items-center px-2 py-1.5 bg-bg-tertiary border border-border-default text-sm text-text-tertiary opacity-60 cursor-not-allowed">
            {shown}
          </div>
          {help ? <span className={HELP_CLASS}>{help}</span> : null}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-secondary">{label}</span>
        {/* We render the parameter's own label above; tell the picker to drop
            its internal "Detector" header so the label isn't shown twice. */}
        <ModelPicker
          droneId={droneId}
          mode="compact"
          hideHeaderLabel
          onActiveChange={(modelId) => onCommit(modelId)}
        />
        {help ? <span className={HELP_CLASS}>{help}</span> : null}
      </div>
    );
  }

  if (widget === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <Toggle
          label={label}
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(checked) => onCommit(checked)}
        />
        {help ? <span className={HELP_CLASS}>{help}</span> : null}
      </div>
    );
  }

  if (widget === "enum") {
    const enumVals = schema.enum ?? [];
    const options = enumVals.map((e) => ({ value: String(e), label: String(e) }));
    const onEnumChange = (next: string) => {
      const match = enumVals.find((e) => String(e) === next);
      if (match === undefined) return;
      if (!validateValue(schema, match).ok) return;
      onCommit(match);
    };
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">{label}</span>
        <Select
          options={options}
          value={String(value)}
          onChange={onEnumChange}
          disabled={disabled}
        />
        {help ? <span className={HELP_CLASS}>{help}</span> : null}
      </div>
    );
  }

  if (widget === "bitmask") {
    const bits = new Map((ui?.bits ?? []).map((b) => [b.bit, b.label]));
    const intVal = typeof value === "number" ? value : Number(value) || 0;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">{label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setBitmaskOpen(true)}
          className="h-8 px-2 text-left text-sm font-mono border border-border-default bg-bg-tertiary text-text-primary hover:border-accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {summarizeBitmask(intVal, bits)}
        </button>
        {help ? <span className={HELP_CLASS}>{help}</span> : null}
        <BitmaskEditor
          open={bitmaskOpen}
          onClose={() => setBitmaskOpen(false)}
          title={label}
          bitmask={bits}
          value={intVal}
          readOnly={disabled}
          onApply={(next) => onCommit(next)}
        />
      </div>
    );
  }

  if (widget === "range") {
    const min = schema.minimum ?? 0;
    const max = schema.maximum ?? 100;
    const step = schema.step ?? 1;
    return (
      <FieldShell htmlFor={inputId} label={label} help={help} error={error}>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="range"
            min={min}
            max={max}
            step={step}
            value={rangeVal}
            disabled={disabled}
            onChange={(e) => setRangeVal(Number(e.target.value))}
            onPointerUp={commitRange}
            onKeyUp={commitRange}
            onBlur={commitRange}
            className="flex-1 accent-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="w-12 text-right text-xs font-mono text-text-primary">
            {rangeVal}
          </span>
        </div>
      </FieldShell>
    );
  }

  if (widget === "number") {
    return (
      <FieldShell htmlFor={inputId} label={label} help={help} error={error}>
        <input
          id={inputId}
          type="number"
          value={text}
          disabled={disabled}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.step}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNumber(e.currentTarget.value);
            } else if (e.key === "Escape") {
              setText(String(value));
              setError(null);
            }
          }}
          className={cn(
            FIELD_INPUT_CLASS,
            error ? "border-status-error" : "border-border-default",
          )}
        />
      </FieldShell>
    );
  }

  // string (default)
  return (
    <FieldShell htmlFor={inputId} label={label} help={help} error={error}>
      <input
        id={inputId}
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commitString(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitString(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setText(String(value));
            setError(null);
          }
        }}
        className={cn(
          FIELD_INPUT_CLASS,
          error ? "border-status-error" : "border-border-default",
        )}
      />
    </FieldShell>
  );
}
