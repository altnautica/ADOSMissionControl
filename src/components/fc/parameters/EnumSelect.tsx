"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";

export interface EnumSelectProps {
  /** Enum code → label. */
  values: ReadonlyMap<number, string>;
  /** Current numeric value. */
  value: number;
  onChange: (next: number) => void;
  /** Called after a commit so the grid can leave edit mode. */
  onClose?: () => void;
  disabled?: boolean;
  /** Extra classes for the select trigger (e.g. a dirty-state border). */
  className?: string;
}

/**
 * Enum value editor using the app's portal `<Select>` (never a native
 * `<select>`). Shows `code: label` options, auto-enables search for long
 * enums, keeps an out-of-enum value selectable, and offers a "123" toggle to
 * type an arbitrary numeric value not present in the enum.
 */
export function EnumSelect({ values, value, onChange, onClose, disabled = false, className }: EnumSelectProps) {
  const t = useTranslations("parameters");
  const [manual, setManual] = useState(false);
  const [raw, setRaw] = useState(String(value));

  const options = useMemo<SelectOption[]>(() => {
    const opts = [...values.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, label]) => ({ value: String(code), label: `${code}: ${label}` }));
    if (!values.has(Math.trunc(value)) && !values.has(value)) {
      opts.push({ value: String(value), label: t("customValue", { value }) });
    }
    return opts;
  }, [values, value, t]);

  const commitManual = () => {
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) onChange(n);
    onClose?.();
  };

  if (manual) {
    return (
      <input
        autoFocus
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commitManual(); if (e.key === "Escape") onClose?.(); }}
        onBlur={commitManual}
        disabled={disabled}
        className="w-full h-6 px-1.5 bg-bg-tertiary border border-accent-primary text-xs font-mono text-text-primary focus:outline-none"
      />
    );
  }

  return (
    <div className="flex items-center gap-1 w-full">
      <div className="flex-1 min-w-0">
        <Select
          options={options}
          value={String(value)}
          onChange={(v) => { onChange(Number(v)); onClose?.(); }}
          disabled={disabled}
          className={className}
          searchable={values.size > 15}
        />
      </div>
      <button
        type="button"
        title={t("enterCustomValue")}
        onClick={() => { setRaw(String(value)); setManual(true); }}
        className="flex-shrink-0 px-1 h-6 text-[10px] font-mono text-text-tertiary hover:text-accent-primary cursor-pointer"
      >
        123
      </button>
    </div>
  );
}
