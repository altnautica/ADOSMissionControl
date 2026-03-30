"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RotateCw, Star, ChevronUp, ChevronDown, Lock, AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { ParamTooltip } from "./ParamTooltip";
import { PARAM_TYPE_LABELS, isReadOnly, getDangerousWarning, isValueOutOfRange } from "./parameter-grid-utils";
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
}

const ROW_HEIGHT = 32;
const BITMASK_ROW_HEIGHT = 200; // estimated height for bitmask editing rows

const HEADER_CLASS = "px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap text-xs";

export function ParameterGrid({ parameters, modified, onModify, filter, showModifiedOnly, metadata, columnVisibility }: ParameterGridProps) {
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dangerousWarning, setDangerousWarning] = useState<{ name: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
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
    vis.range && "minmax(100px, 1fr)",               // Range
    vis.units && "minmax(50px, 0.5fr)",              // Units
    vis.type && "minmax(60px, 0.5fr)",               // Type
  ].filter(Boolean).join(" "), [vis.index, vis.name, vis.description, vis.value, vis.range, vis.units, vis.type]);

  const filtered = useMemo(() => {
    let result = parameters;
    if (showModifiedOnly) {
      result = result.filter((p) => modified.has(p.name));
    }
    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter((p) => {
        if (p.name.toLowerCase().includes(lower)) return true;
        const meta = metadata?.get(p.name);
        if (meta?.humanName?.toLowerCase().includes(lower)) return true;
        if (meta?.description?.toLowerCase().includes(lower)) return true;
        return false;
      });
    }
    return result;
  }, [parameters, filter, showModifiedOnly, modified, metadata]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const param = filtered[index];
      if (editingParam === param?.name) {
        const meta = metadata?.get(param.name);
        if (meta?.bitmask && meta.bitmask.size > 0) return BITMASK_ROW_HEIGHT;
      }
      return ROW_HEIGHT;
    },
    overscan: 10,
  });

  const startEdit = useCallback((param: ParameterValue) => {
    const meta = metadata?.get(param.name);
    if (isReadOnly(param.name, meta)) return;
    const current = modified.has(param.name) ? modified.get(param.name)! : param.value;
    setEditingParam(param.name);
    setEditValue(String(current));
    requestAnimationFrame(() => { inputRef.current?.focus(); selectRef.current?.focus(); });
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

  const commitSelectEdit = useCallback((name: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) onModify(name, num);
    setEditingParam(null);
  }, [onModify]);

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
                  className={cn("grid items-center border-b border-border-default h-8 transition-colors", isModified ? "bg-status-warning/5" : isPendingRam ? "bg-orange-500/8" : differsFromDefault && "border-l-2 border-l-accent-primary bg-accent-primary/5")}
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
                        <ParamTooltip meta={meta}><span className="cursor-default">{param.name}</span></ParamTooltip>
                        {readOnly && <Lock size={10} className="text-text-tertiary flex-shrink-0" />}
                      </div>
                    </div>
                  )}
                  {vis.description && <div className="px-3 text-text-secondary truncate" title={meta?.description}>{meta?.humanName || meta?.description || "\u2014"}</div>}
                  {vis.value && (
                    <div className="px-3 overflow-hidden">
                      <div className="flex items-center gap-1">
                        {isEditing && hasBitmask ? (
                          <div className="flex flex-col gap-0.5 py-1">
                            {Array.from(meta!.bitmask!.entries()).map(([bit, label]) => {
                              const currentVal = parseInt(editValue) || 0;
                              const isSet = (currentVal & (1 << bit)) !== 0;
                              return (
                                <label key={bit} className="flex items-center gap-1.5 text-[10px] text-text-secondary cursor-pointer">
                                  <input type="checkbox" checked={isSet} onChange={() => { const newVal = currentVal ^ (1 << bit); setEditValue(String(newVal)); onModify(param.name, newVal); }} className="w-3 h-3" />
                                  <span className="font-mono">{bit}:</span> {label}
                                </label>
                              );
                            })}
                            <button onClick={() => setEditingParam(null)} className="text-[10px] text-accent-primary hover:underline mt-0.5 text-left cursor-pointer">Done</button>
                          </div>
                        ) : isEditing ? (
                          hasEnum ? (
                            <select ref={selectRef} value={editValue} onChange={(e) => { setEditValue(e.target.value); commitSelectEdit(param.name, e.target.value); }} onBlur={() => commitEdit(param.name)} onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }} className="w-full h-6 px-1 bg-bg-tertiary border border-accent-primary text-xs font-mono text-text-primary focus:outline-none">
                              {Array.from(meta!.values!.entries()).map(([code, label]) => (<option key={code} value={code}>{code}: {label}</option>))}
                              {!meta!.values!.has(Number(editValue)) && <option value={editValue}>{editValue} (custom)</option>}
                            </select>
                          ) : (
                            <div className="w-full">
                              <input ref={inputRef} type="text" value={editValue} onChange={(e) => { setEditValue(e.target.value); if (dangerousWarning?.name === param.name) setDangerousWarning(null); }} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(param.name); if (e.key === "Escape") cancelEdit(); }} onBlur={() => commitEdit(param.name)} title={editOutOfRange && meta?.range ? `Expected range: ${meta.range.min} .. ${meta.range.max}` : undefined} className={cn("w-full h-6 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary focus:outline-none", dangerousWarning?.name === param.name ? "border-status-error" : editOutOfRange ? "border-status-warning" : "border-accent-primary")} />
                              {dangerousWarning?.name === param.name && (<div className="flex items-center gap-1 mt-0.5 text-[10px] text-status-error"><AlertTriangle size={9} />{dangerousWarning.message}</div>)}
                            </div>
                          )
                        ) : (
                          <>
                            <button onClick={() => !readOnly && startEdit(param)} title={readOnly ? "Read-only parameter" : outOfRange && meta?.range ? `Out of range: expected ${meta.range.min} .. ${meta.range.max}` : isPendingRam && !isModified ? "Written to RAM \u2014 not yet committed to flash" : undefined} className={cn("flex-1 h-6 px-1.5 text-left font-mono transition-colors flex items-center gap-1", readOnly ? "text-text-tertiary cursor-not-allowed" : outOfRange ? "text-status-warning border border-status-warning/60 bg-status-warning/5 cursor-pointer hover:bg-bg-tertiary" : isModified ? "text-status-warning border border-status-warning/40 cursor-pointer hover:bg-bg-tertiary" : isPendingRam ? "text-orange-400 border border-orange-500/40 cursor-pointer hover:bg-bg-tertiary" : "text-text-primary border border-transparent cursor-pointer hover:bg-bg-tertiary")}>
                              <span className="truncate">{hasEnum && meta!.values!.has(displayValue) ? `${displayValue}: ${meta!.values!.get(displayValue)}` : displayValue}</span>
                              {outOfRange && <span className="text-[10px]" title={`Range: ${meta?.range?.min} .. ${meta?.range?.max}`}>!</span>}
                              {isPendingRam && !isModified && <span className="flex-shrink-0" title="RAM only, not flashed"><HardDrive size={10} className="text-orange-400" /></span>}
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
                  {vis.range && <div className="px-3 text-text-tertiary font-mono whitespace-nowrap">{meta?.range ? `${meta.range.min} .. ${meta.range.max}` : "\u2014"}</div>}
                  {vis.units && <div className="px-3 text-text-tertiary">{meta?.units || "\u2014"}</div>}
                  {vis.type && <div className="px-3 text-text-tertiary font-mono">{PARAM_TYPE_LABELS[param.type] ?? `T${param.type}`}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
