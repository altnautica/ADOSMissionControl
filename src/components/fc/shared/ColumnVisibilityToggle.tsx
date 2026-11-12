"use client";

import { useTranslations } from "next-intl";
import { useState, useRef, useEffect } from "react";
import { Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ParamColumnId } from "@/stores/settings-store";

const COLUMNS: { id: ParamColumnId; label: string; locked?: boolean }[] = [
  { id: "index", label: "#" },
  { id: "name", label: "Name", locked: true },
  { id: "description", label: "Description" },
  { id: "value", label: "Value", locked: true },
  { id: "range", label: "Range" },
  { id: "units", label: "Units" },
  { id: "type", label: "Type" },
  { id: "options", label: "Options" },
];

export function ColumnVisibilityToggle() {
  const tr = useTranslations("fcPanels.columnVisibilityToggle");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const paramColumns = useSettingsStore((s) => s.paramColumns);
  const setParamColumn = useSettingsStore((s) => s.setParamColumn);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "h-8 w-8 flex items-center justify-center border border-border-default text-text-secondary transition-colors cursor-pointer",
          open ? "bg-bg-tertiary text-text-primary" : "hover:bg-bg-tertiary hover:text-text-primary"
        )}
        title={tr("toggleColumns")}
      >
        <Columns3 size={14} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[160px] bg-bg-secondary border border-border-default py-1">
          <div className="px-3 py-1.5 border-b border-border-default">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{tr("columns")}</span>
          </div>
          {COLUMNS.map((col) => (
            <label
              key={col.id}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                col.locked
                  ? "text-text-tertiary cursor-not-allowed"
                  : "text-text-primary hover:bg-bg-tertiary cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                checked={paramColumns[col.id]}
                disabled={col.locked}
                onChange={() => {
                  if (!col.locked) setParamColumn(col.id, !paramColumns[col.id]);
                }}
                className="accent-accent-primary"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
