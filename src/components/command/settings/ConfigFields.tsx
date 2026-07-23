"use client";

/**
 * @module command/settings/ConfigFields
 * @description Reusable, agent-config-bound field primitives for the node
 * Settings tab. Each field reads its current value from the loaded config by
 * dot-path and writes back through the shared `setValue`. A Select / Toggle
 * writes immediately on change; a text field writes on Apply. A read-only row
 * shows a value the operator manages elsewhere (a transactional setup flow) so
 * the surface never ships a partial, inconsistent write.
 * @license GPL-3.0-only
 */

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Select, type SelectOption } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { readConfigPath } from "./use-node-config";

interface BaseProps {
  configKey: string;
  label: string;
  hint?: string;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** A Select bound to a string config key; writes on change. `placeholder`
 * overrides the default "not set" shown when the stored value matches no option
 * (e.g. an unset tri-state whose effective default is "auto"). */
export function ConfigSelectField({
  configKey,
  label,
  hint,
  options,
  placeholder,
  config,
  readOnly,
  setValue,
}: BaseProps & { options: SelectOption[]; placeholder?: string }) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const raw = readConfigPath(config, configKey);
  const current = typeof raw === "string" ? raw : raw != null ? String(raw) : "";
  const value = pending ?? current;

  const onChange = async (next: string) => {
    if (readOnly || saving || next === value) return;
    setPending(next);
    setSaving(true);
    try {
      await setValue(configKey, next);
      toast(t("applied"), "success");
      // `setValue` re-reads the config, so `current` now holds the persisted
      // value. Drop the optimistic pending so the field tracks the confirmed
      // read-back and returns to interactive.
      setPending(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      setPending(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label={label}
        options={options}
        value={value}
        onChange={(v) => void onChange(v)}
        disabled={readOnly || saving}
        placeholder={placeholder ?? t("notSet")}
      />
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

/** An optional confirmation gate for a toggle write. When `when(next)` is true
 * for the attempted transition, the write is held behind a danger ConfirmDialog
 * — used to gate a security downgrade (e.g. turning an auth requirement OFF) or
 * a link-affecting change so a single stray click can't apply it. A safe
 * transition (`when` returns false) writes immediately. */
export interface ToggleConfirm {
  when: (next: boolean) => boolean;
  title: string;
  message: string;
  confirmLabel: string;
}

/** A Toggle bound to a boolean config key; writes on change. When a `confirm`
 * gate is supplied and the attempted transition matches it, the write is held
 * behind a ConfirmDialog until the operator confirms. */
export function ConfigToggleField({
  configKey,
  label,
  hint,
  config,
  readOnly,
  setValue,
  confirm,
}: BaseProps & { confirm?: ToggleConfirm }) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  // The value awaiting confirmation. Null while no dialog is open; the toggle
  // stays at its current position (pending is not set) until confirmed, so a
  // cancel is a true no-op.
  const [confirmNext, setConfirmNext] = useState<boolean | null>(null);

  const raw = readConfigPath(config, configKey);
  const current = raw === true;
  const checked = pending ?? current;

  const applyChange = async (next: boolean) => {
    setPending(next);
    setSaving(true);
    try {
      await setValue(configKey, next ? "true" : "false");
      toast(t("applied"), "success");
      // `setValue` re-reads the config, so `current` now holds the persisted
      // value. Drop the optimistic pending so the toggle tracks the confirmed
      // read-back and returns to interactive.
      setPending(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      setPending(null);
    } finally {
      setSaving(false);
    }
  };

  const onChange = async (next: boolean) => {
    if (readOnly || saving) return;
    if (confirm && confirm.when(next)) {
      setConfirmNext(next);
      return;
    }
    await applyChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Toggle
        label={label}
        checked={checked}
        onChange={(v) => void onChange(v)}
        disabled={readOnly || saving}
      />
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
      {confirm ? (
        <ConfirmDialog
          open={confirmNext !== null}
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          variant="danger"
          onCancel={() => setConfirmNext(null)}
          onConfirm={() => {
            const next = confirmNext;
            setConfirmNext(null);
            if (next !== null) void applyChange(next);
          }}
        />
      ) : null}
    </div>
  );
}

/** A text field bound to a string config key; writes on Apply. Empty commits
 * an empty string (e.g. clearing a board override → auto-detect). */
export function ConfigTextField({
  configKey,
  label,
  hint,
  placeholder,
  config,
  readOnly,
  setValue,
}: BaseProps & { placeholder?: string }) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const inputId = useId();
  const raw = readConfigPath(config, configKey);
  const current = typeof raw === "string" ? raw : raw != null ? String(raw) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;

  const onApply = async () => {
    if (readOnly || saving || !dirty) return;
    setSaving(true);
    try {
      await setValue(configKey, value.trim());
      toast(t("applied"), "success");
      setDraft(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
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
          disabled={readOnly || saving}
          className="h-9 flex-1 rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onApply()}
          disabled={readOnly || saving || !dirty}
        >
          {saving ? t("saving") : t("apply")}
        </Button>
      </div>
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

/** A write-only secret field bound to a string config key; writes a NEW value
 * on Apply and NEVER reads or renders the current one. It shows only a
 * set / not-set state (derived from whether the config holds a non-empty
 * value — the value itself is never displayed), and an empty input is a no-op
 * so a stored secret is never clobbered with "". Use for passphrases the agent
 * emits in plain text (e.g. the hotspot passphrase, which GET does not
 * redact). */
export function ConfigSecretField({
  configKey,
  label,
  hint,
  placeholder,
  config,
  readOnly,
  setValue,
}: BaseProps & { placeholder?: string }) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const inputId = useId();
  const raw = readConfigPath(config, configKey);
  const isSet = typeof raw === "string" && raw.length > 0;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = draft.length > 0;

  const onApply = async () => {
    if (readOnly || saving || !dirty) return;
    setSaving(true);
    try {
      await setValue(configKey, draft);
      toast(t("applied"), "success");
      setDraft("");
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-xs text-text-secondary">
          {label}
        </label>
        <span className="font-mono text-[11px] text-text-tertiary">
          {isSet ? t("set") : t("notSet")}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <input
          id={inputId}
          type="password"
          value={draft}
          placeholder={placeholder ?? t("secretPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          disabled={readOnly || saving}
          autoComplete="new-password"
          className="h-9 flex-1 rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onApply()}
          disabled={readOnly || saving || !dirty}
        >
          {saving ? t("saving") : t("apply")}
        </Button>
      </div>
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

/** Parse an operator-typed integer within [min, max]. Null when invalid. */
export function parseBoundedInt(
  raw: string,
  min: number,
  max: number,
): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** An integer config field with range validation, writing on Apply through
 * the shared config writer and re-reading via the caller's config prop. */
export function ConfigIntField({
  configKey,
  label,
  hint,
  min,
  max,
  config,
  readOnly,
  setValue,
}: BaseProps & { min: number; max: number }) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const raw = readConfigPath(config, configKey);
  const current =
    typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;
  const invalid = dirty && parseBoundedInt(value, min, max) === null;

  const onApply = async () => {
    if (readOnly || saving || !dirty || invalid) return;
    setSaving(true);
    try {
      await setValue(configKey, value.trim());
      toast(t("applied"), "success");
      setDraft(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-text-secondary">{label}</label>
      <div className="flex items-end gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          disabled={readOnly || saving}
          aria-label={label}
          aria-invalid={invalid || undefined}
          className="h-9 w-28 rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onApply()}
          disabled={readOnly || saving || !dirty || invalid}
        >
          {saving ? t("saving") : t("apply")}
        </Button>
      </div>
      {invalid ? (
        <p className="text-[11px] text-status-error">
          {t("intInvalid", { min, max })}
        </p>
      ) : null}
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

/** A labeled read-only value the operator manages in a transactional setup flow
 * (profile switch, cloud posture). Shows the real current value or "not set". */
export function ConfigReadonlyRow({
  configKey,
  label,
  hint,
  config,
  format,
}: {
  configKey: string;
  label: string;
  hint?: string;
  config: Record<string, unknown> | null;
  format?: (raw: unknown) => string | null;
}) {
  const t = useTranslations("nodeSettings");
  const raw = readConfigPath(config, configKey);
  const shown = format
    ? format(raw)
    : typeof raw === "string" && raw.length > 0
      ? raw
      : raw != null
        ? String(raw)
        : null;

  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        {hint ? (
          <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>
        ) : null}
      </div>
      <div className="shrink-0 font-mono text-sm text-text-primary">
        {shown ?? <span className="text-text-tertiary">{t("notSet")}</span>}
      </div>
    </div>
  );
}
