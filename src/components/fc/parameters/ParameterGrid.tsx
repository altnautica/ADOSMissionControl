"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RotateCw, Star, ChevronUp, ChevronDown, Lock, AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { ParamTooltip } from "./ParamTooltip";
import { PARAM_TYPE_LABELS, isReadOnly, getDangerousWarning, isValueOutOfRange, buildSearchHaystack } from "./parameter-grid-utils";
import { EnumSelect } from "./EnumSelect";
import { BitmaskEditor } from "@/components/ui/bitmask-editor";
import { getParamDocUrlFromContext, type ParamDocContext } from "@/lib/protocol/param-docs";
import { formatParamDisplayValue } from "@/lib/protocol/param-display";
import type { ParameterValue } from "@/lib/protocol/types";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import type { ParamColumnVisibility } from "@/stores/settings-store";

interface ParameterGridProps {
  parameters: ParameterValue[];
  modified: Map<string, number>;
  onModify: (name: string, value: number) => void;
  filter: string;
  showModifiedOnly: boolean;
  metadata?: Map<string, ParamMetadata>;
  columnVisibility: ParamColumnVisibility;
  docContext?: ParamDocContext | null;
  docsLinkLabel?: string;
}

const ROW_HEIGHT = 32;

const HEADER_CLASS = "px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap text-xs";

export function ParameterGrid({ parameters, modified, onModify, filter, showModifiedOnly, metadata, columnVisibility, docContext = null, docsLinkLabel }: ParameterGridProps) {
  const t = useTranslations("parameters");
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [bitmaskEditParam, setBitmaskEditParam] = useState<string | null>(null);
  const [dangerousWarning, setDangerousWarning] = useState<{ name: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavorite);
  const favoriteParams = useSettingsStore((s) => s.favoriteParams);
  const pendingWrites = useParamSafetyStore((s) => s.pendingWrites);

  // O(1) favorite lookup instead of O(n) .includes()
  const favSet = useMemo(() => new Set(favoriteParams), [favoriteParams]);

  const vis = columnVisibility;

  const gridCols = useMemo(() => [
    "24px",                                          // star/favorite
    vis.index && "50px",                             // #
    vis.name && "minmax(120px, 2fr)",                // Name
    vis.description && "minmax(100px, 1.5fr)",       // Description
    vis.value && "minmax(160px, 2fr)",               // Value
    vis.options && "minmax(140px, 1.5fr)",           // Options
    vis.range && "minmax(100px, 1fr)",               // Range
    vis.units && "minmax(50px, 0.5fr)",              // Units
    vis.type && "minmax(60px, 0.5fr)",               // Type
  ].filter(Boolean).join(" "), [vis.index, vis.name, vis.description, vis.value, vis.options, vis.range, vis.units, vis.type]);

  // Per-metadata search haystack (name + humanName + description + all enum /
  // bitmask labels), built once per metadata load so a keystroke is one
  // `.includes` rather than re-walking every param's option Maps.
  const searchHaystack = useMemo(
    () => buildSearchHaystack(metadata, metadata ? [...metadata.keys()] : []),
    [metadata],
  );

  const filtered = useMemo(() => {
    let result = parameters;
    if (showModifiedOnly) {
      result = result.filter((p) => modified.has(p.name));
    }
    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter((p) => (searchHaystack.get(p.name) ?? p.name.toLowerCase()).includes(lower));
    }
    return result;
  }, [parameters, filter, showModifiedOnly, modified, searchHaystack]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const startEdit = useCallback((param: ParameterValue) => {
    const meta = metadata?.get(param.name);
    if (isReadOnly(param.name, meta)) return;
    // Bitmask params edit in a modal, not inline.
    if (meta?.bitmask && meta.bitmask.size > 0) { setBitmaskEditParam(param.name); return; }
    const current = modified.has(param.name) ? modified.get(param.name)! : param.value;
    setEditingParam(param.name);
    setEditValue(String(current));
    requestAnimationFrame(() => { inputRef.current?.focus(); });
  }, [modified, metadata]);

  const commitEdit = useCallback((name: string) => {
    const num = parseFloat(editValue);
    if (!isNaN(num)) {
      const warning = getDangerousWarning(name, num);
      if (warning) { setDangerousWarning({ name, message: warning }); return; }
      setDangerousWarning(null);
      onModify(name, num);
    }
    setEditingParam(null);
  }, [editValue, onModify]);

  const cancelEdit = useCallback(() => { setEditingParam(null); setDangerousWarning(null); }, []);

  return (
    <div ref={parentRef} className="overflow-auto flex-1">
      <div className="min-w-[600px] text-xs">
        {/* Header */}
        <div
          className="sticky top-0 bg-bg-secondary z-10 grid items-center border-b border-border-default"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="px-1" />
          {vis.index && <div className={HEADER_CLASS}>#</div>}
          {vis.name && <div className={HEADER_CLASS}>Name</div>}
          {vis.description && <div className={HEADER_CLASS}>Description</div>}
          {vis.value && <div className={HEADER_CLASS}>Value</div>}
          {vis.options && <div className={HEADER_CLASS}>{t("optionsColumn")}</div>}
          {vis.range && <div className={HEADER_CLASS}>Range</div>}
          {vis.units && <div className={HEADER_CLASS}>Units</div>}
          {vis.type && <div className={HEADER_CLASS}>Type</div>}
        </div>

        {/* Body */}
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-text-tertiary">
              {parameters.length === 0 ? "No parameters loaded" : showModifiedOnly && modified.size === 0 ? "No modified parameters" : showModifiedOnly ? "No modified parameters match the search" : "No matching parameters"}
            </div>
          ) : (
            rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const param = filtered[virtualRow.index];
              const isModified = modified.has(param.name);
              const isPendingRam = pendingWrites.has(param.name);
              const displayValue = isModified ? modified.get(param.name)! : param.value;
              const isEditing = editingParam === param.name;
              const meta = metadata?.get(param.name);
              const hasEnum = meta?.values && meta.values.size > 0;
              const hasBitmask = meta?.bitmask && meta.bitmask.size > 0;
              const outOfRange = isModified && isValueOutOfRange(displayValue, meta);
              const editOutOfRange = isEditing && !isNaN(parseFloat(editValue)) && isValueOutOfRange(parseFloat(editValue), meta);
              const hasDefault = meta?.defaultValue !== undefined;
              const differsFromDefault = hasDefault && displayValue !== meta!.defaultValue;
              const readOnly = isReadOnly(param.name, meta);
              const isFav = favSet.has(param.name);

              return (
                <div
                  key={`${param.name}-${param.index}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={cn("grid items-center border-b border-border-default h-8 transition-colors", isModified ? "bg-status-warning/5" : isPendingRam ? "bg-status-serious/8" : differsFromDefault && "border-l-2 border-l-accent-primary bg-accent-primary/5")}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: gridCols,
                  }}
                >
                  <div className="px-1 text-center">
                    <button onClick={() => toggleFavorite(param.name)} className={cn("flex-shrink-0 p-0.5 transition-colors cursor-pointer", isFav ? "text-status-warning" : "text-text-tertiary hover:text-text-secondary")}>
                      <Star size={10} fill={isFav ? "currentColor" : "none"} />
                    </button>
                  </div>
                  {vis.index && <div className="px-3 text-text-tertiary font-mono">{param.index}</div>}
                  {vis.name && (
                    <div className={cn("px-3 font-mono truncate", differsFromDefault && !isModified ? "text-accent-primary" : "text-text-primary")}>
                      <div className="flex items-center gap-1">
                        <ParamTooltip
                          meta={meta}
                          docUrl={getParamDocUrlFromContext(param.name, docContext)}
                          docsLinkLabel={docsLinkLabel}
                        >
                          <span className="cursor-default">{param.name}</span>
                        </ParamTooltip>
                        {readOnly && <Lock size={10} className="text-text-tertiary flex-shrink-0" />}
                      </div>
                    </div>
                  )}
                  {vis.description && <div className="px-3 text-text-secondary truncate" title={meta?.description}>{meta?.humanName || meta?.description || "—"}</div>}
                  {vis.value && (
                    <div className="px-3 overflow-hidden">
                      <div className="flex items-center gap-1">
                        {isEditing && hasEnum ? (
                          <EnumSelect
                            values={meta!.values!}
                            value={Number(editValue)}
                            onChange={(n) => { onModify(param.name, n); setEditingParam(null); }}
                            onClose={cancelEdit}
                          />
                        ) : isEditing ? (
                          <div className="w-full">
                            <input ref={inputRef} type="text" value={editValue} onChange={(e) => { setEditValue(e.target.value); if (dangerousWarning?.name === param.name) setDangerousWarning(null); }} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(param.name); if (e.key === "Escape") cancelEdit(); }} onBlur={() => commitEdit(param.name)} title={editOutOfRange && meta?.range ? `Expected range: ${meta.range.min} .. ${meta.range.max}` : undefined} className={cn("w-full h-6 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary focus:outline-none", dangerousWarning?.name === param.name ? "border-status-error" : editOutOfRange ? "border-status-warning" : "border-accent-primary")} />
                            {dangerousWarning?.name === param.name && (<div className="flex items-center gap-1 mt-0.5 text-[10px] text-status-error"><AlertTriangle size={9} />{dangerousWarning.message}</div>)}
                          </div>
                        ) : (
                          <>
                            <button onClick={() => !readOnly && startEdit(param)} title={readOnly ? "Read-only parameter" : outOfRange && meta?.range ? `Out of range: expected ${meta.range.min} .. ${meta.range.max}` : isPendingRam && !isModified ? "Written to RAM — not yet committed to flash" : undefined} className={cn("flex-1 h-6 px-1.5 text-left font-mono transition-colors flex items-center gap-1 min-w-0", readOnly ? "text-text-tertiary cursor-not-allowed" : outOfRange ? "text-status-warning border border-status-warning/60 bg-status-warning/5 cursor-pointer hover:bg-bg-tertiary" : isModified ? "text-status-warning border border-status-warning/40 cursor-pointer hover:bg-bg-tertiary" : isPendingRam ? "text-status-serious border border-status-serious/40 cursor-pointer hover:bg-bg-tertiary" : "text-text-primary border border-transparent cursor-pointer hover:bg-bg-tertiary")}>
                              <span className="truncate">{formatParamDisplayValue(displayValue, meta)}</span>
                              {outOfRange && <span className="text-[10px]" title={`Range: ${meta?.range?.min} .. ${meta?.range?.max}`}>!</span>}
                              {isPendingRam && !isModified && <span className="flex-shrink-0" title="RAM only, not flashed"><HardDrive size={10} className="text-status-serious" /></span>}
                            </button>
                            {!readOnly && meta?.increment && !hasEnum && !hasBitmask && (
                              <div className="flex flex-col">
                                <button onClick={() => { const newVal = displayValue + meta.increment!; if (meta.range && newVal > meta.range.max) return; onModify(param.name, parseFloat(newVal.toFixed(10))); }} className="text-text-tertiary hover:text-text-primary p-0 leading-none cursor-pointer" title={`+${meta.increment}`}><ChevronUp size={10} /></button>
                                <button onClick={() => { const newVal = displayValue - meta.increment!; if (meta.range && newVal < meta.range.min) return; onModify(param.name, parseFloat(newVal.toFixed(10))); }} className="text-text-tertiary hover:text-text-primary p-0 leading-none cursor-pointer" title={`-${meta.increment}`}><ChevronDown size={10} /></button>
                              </div>
                            )}
                            {differsFromDefault && !readOnly && <button onClick={() => onModify(param.name, meta!.defaultValue!)} title={`Reset to default: ${meta!.defaultValue}`} className="flex-shrink-0 p-0.5 text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"><RotateCw size={10} /></button>}
                            {hasDefault && <span className="flex-shrink-0 text-[10px] text-text-tertiary font-mono" title={`Default: ${meta!.defaultValue}`}>d:{meta!.defaultValue}</span>}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {vis.options && (
                    <div className="px-3 overflow-hidden">
                      {hasBitmask ? (
                        <button
                          onClick={() => setBitmaskEditParam(param.name)}
                          className="px-2 h-5 text-[11px] border border-status-success/50 text-status-success bg-status-success/5 hover:bg-status-success/10 cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {t("setBitmask")}
                        </button>
                      ) : hasEnum ? (
                        <button
                          onClick={() => !readOnly && startEdit(param)}
                          disabled={readOnly}
                          title={[...meta!.values!.entries()].map(([c, l]) => `${c}: ${l}`).join("\n")}
                          className="text-text-tertiary font-mono truncate text-left w-full hover:text-text-secondary cursor-pointer disabled:cursor-default"
                        >
                          {[...meta!.values!.entries()].map(([c, l]) => `${c}:${l}`).join(" ")}
                        </button>
                      ) : (
                        <span className="text-text-tertiary">{"—"}</span>
                      )}
                    </div>
                  )}
                  {vis.range && <div className="px-3 text-text-tertiary font-mono whitespace-nowrap">{meta?.range ? `${meta.range.min} .. ${meta.range.max}` : "—"}</div>}
                  {vis.units && <div className="px-3 text-text-tertiary">{meta?.units || "—"}</div>}
                  {vis.type && <div className="px-3 text-text-tertiary font-mono">{PARAM_TYPE_LABELS[param.type] ?? `T${param.type}`}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {bitmaskEditParam && (() => {
        const meta = metadata?.get(bitmaskEditParam);
        if (!meta?.bitmask) return null;
        const p = filtered.find((x) => x.name === bitmaskEditParam) ?? parameters.find((x) => x.name === bitmaskEditParam);
        const current = modified.has(bitmaskEditParam) ? modified.get(bitmaskEditParam)! : (p?.value ?? 0);
        return (
          <BitmaskEditor
            open
            title={t("bitmaskTitle", { name: bitmaskEditParam })}
            bitmask={meta.bitmask}
            value={current}
            readOnly={isReadOnly(bitmaskEditParam, meta)}
            onApply={(next) => onModify(bitmaskEditParam, next)}
            onClose={() => setBitmaskEditParam(null)}
          />
        );
      })()}
    </div>
  );
}
