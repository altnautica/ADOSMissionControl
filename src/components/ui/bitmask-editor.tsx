"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BitmaskEditorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Documented bit index → label. */
  bitmask: Map<number, string>;
  /** Current numeric value (may carry undocumented bits). */
  value: number;
  /** Commit handler — receives the new unsigned integer value. */
  onApply: (next: number) => void;
  readOnly?: boolean;
}

const u32 = (n: number) => n >>> 0;

/**
 * "Set Bitmask" modal — one labeled checkbox per documented bit, with
 * Select-all / Clear-all, a search filter for many-bit params, a raw
 * decimal/hex readout, and preservation of bits set in the value but absent
 * from the metadata (rendered as "bit N (unknown)" so they are never silently
 * zeroed). Editing is staged on a local draft; Apply commits, Cancel discards.
 */
export function BitmaskEditor({
  open,
  onClose,
  title,
  bitmask,
  value,
  onApply,
  readOnly = false,
}: BitmaskEditorProps) {
  const t = useTranslations("parameters");
  const [draft, setDraft] = useState<number>(() => u32(Math.trunc(value)));
  const [search, setSearch] = useState("");

  // Re-sync the draft to the incoming value on the closed→open transition
  // (storing-info-from-previous-render pattern — resets on open, never mid-edit).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(u32(Math.trunc(value)));
      setSearch("");
    }
  }

  const intVal = u32(draft);

  const sortedBits = useMemo(
    () => [...bitmask.entries()].sort((a, b) => a[0] - b[0]),
    [bitmask],
  );
  const knownMask = useMemo(() => {
    let m = 0;
    for (const [bit] of bitmask) if (bit >= 0 && bit < 32) m |= 1 << bit;
    return u32(m);
  }, [bitmask]);
  const unknownBits = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 32; i++) if ((intVal & (1 << i)) !== 0 && !bitmask.has(i)) out.push(i);
    return out;
  }, [intVal, bitmask]);

  const filteredBits = useMemo(() => {
    if (!search) return sortedBits;
    const q = search.toLowerCase();
    return sortedBits.filter(([bit, label]) => label.toLowerCase().includes(q) || String(bit) === q);
  }, [sortedBits, search]);

  const setCount = useMemo(() => {
    let c = 0;
    for (let i = 0; i < 32; i++) if ((intVal & (1 << i)) !== 0) c++;
    return c;
  }, [intVal]);

  const toggle = (bit: number) => { if (!readOnly) setDraft(u32(intVal ^ (1 << bit))); };
  const selectAll = () => { if (!readOnly) setDraft(u32(intVal | knownMask)); };
  const clearAll = () => { if (!readOnly) setDraft(u32(intVal & ~knownMask)); };

  const onRawChange = (raw: string) => {
    if (readOnly) return;
    const trimmed = raw.trim();
    const parsed = trimmed.toLowerCase().startsWith("0x")
      ? parseInt(trimmed.slice(2), 16)
      : parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) setDraft(u32(parsed));
  };

  const apply = () => { onApply(intVal); onClose(); };

  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>{t("cancel")}</Button>
      <Button variant="primary" size="sm" onClick={apply} disabled={readOnly}>{t("apply")}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} size="md" footer={footer}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-[11px] text-text-tertiary">
          <span>{t("bitmaskBitsSet", { count: setCount, total: bitmask.size })}</span>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAll} className="text-accent-primary hover:underline cursor-pointer focus-ring">{t("selectAll")}</button>
              <span className="text-border-default">|</span>
              <button type="button" onClick={clearAll} className="text-accent-primary hover:underline cursor-pointer focus-ring">{t("clearAll")}</button>
            </div>
          )}
        </div>

        {bitmask.size > 12 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("bitmaskFilter")}
            className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs text-text-primary focus:outline-none focus:border-accent-primary"
          />
        )}

        <div className="flex flex-col gap-0.5 max-h-[46vh] overflow-y-auto pr-1">
          {filteredBits.map(([bit, label]) => {
            const checked = (intVal & (1 << bit)) !== 0;
            return (
              <label
                key={bit}
                className={cn(
                  "flex items-center gap-2 px-1.5 py-1 text-xs cursor-pointer hover:bg-bg-tertiary",
                  readOnly && "cursor-not-allowed opacity-70",
                )}
              >
                <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => toggle(bit)} className="w-3.5 h-3.5 accent-accent-primary" />
                <span className="font-mono text-text-tertiary w-6 text-right">{bit}</span>
                <span className="text-text-primary">{label}</span>
              </label>
            );
          })}
          {unknownBits.map((bit) => (
            <label
              key={`u${bit}`}
              className={cn(
                "flex items-center gap-2 px-1.5 py-1 text-xs cursor-pointer hover:bg-bg-tertiary",
                readOnly && "cursor-not-allowed opacity-70",
              )}
            >
              <input type="checkbox" checked disabled={readOnly} onChange={() => toggle(bit)} className="w-3.5 h-3.5 accent-status-warning" />
              <span className="font-mono text-text-tertiary w-6 text-right">{bit}</span>
              <span className="text-status-warning">{t("unknownBit", { bit })}</span>
            </label>
          ))}
        </div>

        {unknownBits.length > 0 && (
          <p className="text-[11px] text-status-warning">{t("unknownBitsKept", { count: unknownBits.length })}</p>
        )}

        <div className="flex items-center gap-2 border-t border-border-default pt-3">
          <label className="text-[11px] text-text-tertiary">{t("rawValue")}</label>
          <input
            type="text"
            value={String(intVal)}
            onChange={(e) => onRawChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            disabled={readOnly}
            className="w-28 h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary focus-ring disabled:opacity-60"
          />
          <span className="text-[11px] text-text-tertiary font-mono">0x{intVal.toString(16).toUpperCase()}</span>
        </div>
      </div>
    </Modal>
  );
}
