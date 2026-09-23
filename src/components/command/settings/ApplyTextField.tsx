"use client";

/**
 * @module command/settings/ApplyTextField
 * @description The one draft-then-Apply text input the settings pages share:
 * the field holds a local draft over the current value, Apply stays disabled
 * until the draft differs (and passes `validate`), and a failed write keeps the
 * draft so the operator can retry or correct it. The writer owns its own
 * feedback (toast) and throws on failure; the config-bound `ConfigTextField`
 * and the ground-station modem fields both apply through it.
 * @license GPL-3.0-only
 */

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function ApplyTextField({
  label,
  hint,
  placeholder,
  current,
  disabled,
  validate,
  onApply,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  /** The confirmed value the draft starts from and returns to. */
  current: string;
  disabled: boolean;
  /** Returns an error message for an invalid draft, else null. */
  validate?: (draft: string) => string | null;
  /** Writes the trimmed draft. Throws when the write did not land. */
  onApply: (value: string) => Promise<void>;
}) {
  const t = useTranslations("nodeSettings");
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;
  const error = dirty && validate ? validate(value) : null;
  const blocked = disabled || saving || !dirty || error !== null;

  const apply = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      await onApply(value.trim());
      setDraft(null);
    } catch {
      // The writer surfaced the failure; the draft stays for a retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs text-text-secondary">
        {label}
      </label>
      <div className="flex items-end gap-2">
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          aria-invalid={error !== null || undefined}
          className="h-9 flex-1 rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void apply()}
          disabled={blocked}
        >
          {saving ? t("saving") : t("apply")}
        </Button>
      </div>
      {error ? <p className="text-[11px] text-status-error">{error}</p> : null}
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}
