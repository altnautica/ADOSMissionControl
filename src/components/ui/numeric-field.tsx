"use client";

/**
 * @module numeric-field
 * @description Number input that keeps the operator's text as a draft and
 * commits a parsed value on blur or Enter. Partial input ("-", "-3.", an
 * emptied field) never reaches the value; an unparsable or out-of-range entry
 * reverts to the current value instead of becoming 0.
 * @license GPL-3.0-only
 */

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { draftText, useSyncedDraft } from "@/hooks/use-synced-draft";

type NumericFieldProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number | undefined;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
};

export function NumericField({ value, onCommit, min, max, onBlur, onKeyDown, ...rest }: NumericFieldProps) {
  const [draft, setDraft] = useSyncedDraft(draftText(value));

  const commit = () => {
    const n = draft.trim() === "" ? NaN : Number(draft);
    const valid = Number.isFinite(n)
      && (min === undefined || n >= min)
      && (max === undefined || n <= max);
    if (valid && n !== value) onCommit(n);
    else setDraft(draftText(value));
  };

  return (
    <Input
      {...rest}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { commit(); onBlur?.(e); }}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); onKeyDown?.(e); }}
    />
  );
}
