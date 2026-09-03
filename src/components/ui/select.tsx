"use client";

import { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Search } from "lucide-react";
import { isGrouped, flattenOptions } from "./select-types";
import type { SelectOption, SelectOptionGroup, SelectProps } from "./select-types";

export type { SelectOption, SelectOptionGroup, SelectProps };

export function Select({
  label, options, value, onChange, className, placeholder,
  disabled = false, searchable = false, searchPlaceholder = "Search...", maxHeight = 280,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flip: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const uid = useId();
  const selectId = typeof label === "string" ? `select-${label.toLowerCase().replace(/\s+/g, "-")}-${uid}` : `select-${uid}`;

  const allFlat = useMemo(() => flattenOptions(options), [options]);
  const grouped = isGrouped(options);
  const selectedOption = allFlat.find((o) => o.value === value);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    if (grouped) {
      return (options as SelectOptionGroup[])
        .map((g) => ({ ...g, options: g.options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) }))
        .filter((g) => g.options.length > 0);
    }
    return (options as SelectOption[]).filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, search, grouped]);

  const filteredFlat = useMemo(() => flattenOptions(filteredOptions), [filteredOptions]);

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flip = spaceBelow < maxHeight && spaceAbove > spaceBelow;
    let left = rect.left;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    setPos({ top: flip ? rect.top : rect.bottom, left, width: rect.width, flip });
  }, [maxHeight]);

  const open = useCallback(() => { if (disabled) return; setSearch(""); setFocusedIndex(-1); computePosition(); setIsOpen(true); }, [disabled, computePosition]);
  const close = useCallback(() => { setIsOpen(false); setSearch(""); triggerRef.current?.focus(); }, []);
  const toggle = useCallback(() => { if (isOpen) close(); else open(); }, [isOpen, open, close]);
  const selectOpt = useCallback((opt: SelectOption) => { if (opt.disabled) return; onChange(opt.value); close(); }, [onChange, close]);

  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listboxRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => computePosition();
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    window.addEventListener("resize", reposition, { passive: true });
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [isOpen, computePosition]);

  useEffect(() => { if (isOpen && searchable) requestAnimationFrame(() => searchRef.current?.focus()); }, [isOpen, searchable]);
  useEffect(() => { if (focusedIndex >= 0) optionEls.current.get(focusedIndex)?.scrollIntoView({ block: "nearest" }); }, [focusedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (!isOpen) { open(); return; }
        setFocusedIndex((prev) => { let n = prev + 1; while (n < filteredFlat.length && filteredFlat[n]?.disabled) n++; return n < filteredFlat.length ? n : prev; });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (!isOpen) { open(); return; }
        setFocusedIndex((prev) => { let n = prev - 1; while (n >= 0 && filteredFlat[n]?.disabled) n--; return n >= 0 ? n : prev; });
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (!isOpen) { open(); return; }
        if (focusedIndex >= 0 && focusedIndex < filteredFlat.length) selectOpt(filteredFlat[focusedIndex]);
        break;
      }
      case " ": {
        if (searchable && isOpen && e.target === searchRef.current) return;
        e.preventDefault();
        if (!isOpen) { open(); return; }
        if (focusedIndex >= 0 && focusedIndex < filteredFlat.length) selectOpt(filteredFlat[focusedIndex]);
        break;
      }
      case "Escape": { e.preventDefault(); close(); break; }
      case "Home": {
        if (!isOpen) return; e.preventDefault();
        let idx = 0; while (idx < filteredFlat.length && filteredFlat[idx]?.disabled) idx++;
        setFocusedIndex(idx < filteredFlat.length ? idx : -1); break;
      }
      case "End": {
        if (!isOpen) return; e.preventDefault();
        let idx = filteredFlat.length - 1; while (idx >= 0 && filteredFlat[idx]?.disabled) idx--;
        setFocusedIndex(idx >= 0 ? idx : -1); break;
      }
    }
  }, [isOpen, open, close, selectOpt, filteredFlat, focusedIndex, searchable]);

  const renderOption = (opt: SelectOption, flatIdx: number) => {
    const isSelected = opt.value === value;
    const isFocused = flatIdx === focusedIndex;
    return (
      <div key={`${opt.value}-${flatIdx}`}
        ref={(el) => { if (el) optionEls.current.set(flatIdx, el); }}
        role="option" aria-selected={isSelected} aria-disabled={opt.disabled}
        onClick={() => selectOpt(opt)} onMouseEnter={() => !opt.disabled && setFocusedIndex(flatIdx)}
        className={cn(
          "px-2 py-1.5 cursor-pointer flex items-start gap-2",
          isSelected && "border-l-2 border-l-accent-primary", !isSelected && "border-l-2 border-l-transparent",
          isFocused && "bg-bg-tertiary", opt.disabled && "opacity-40 cursor-not-allowed",
          !isFocused && !opt.disabled && "hover:bg-bg-tertiary/50",
        )}>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary truncate">{opt.label}</div>
          {opt.description && <div className="text-[10px] text-text-tertiary mt-0.5 leading-tight">{opt.description}</div>}
        </div>
        {isSelected && <Check size={14} className="text-accent-primary shrink-0 mt-0.5" />}
      </div>
    );
  };

  const renderDropdownContent = () => {
    let flatIdx = 0;
    if (grouped) {
      const groups = filteredOptions as SelectOptionGroup[];
      if (groups.length === 0) return <div className="px-3 py-4 text-xs text-text-tertiary text-center">No matches found</div>;
      return groups.map((group) => (
        <div key={group.label}>
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-tertiary font-medium sticky top-0 bg-bg-secondary">{group.label}</div>
          {group.options.map((opt) => { const el = renderOption(opt, flatIdx); flatIdx++; return el; })}
        </div>
      ));
    }
    const flat = filteredOptions as SelectOption[];
    if (flat.length === 0) return <div className="px-3 py-4 text-xs text-text-tertiary text-center">No matches found</div>;
    return flat.map((opt) => { const el = renderOption(opt, flatIdx); flatIdx++; return el; });
  };

  const dropdownStyle: React.CSSProperties = {
    position: "fixed", left: pos.left, width: Math.max(pos.width, 200), zIndex: 3000,
    ...(pos.flip ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
  };

  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={selectId} className="text-xs text-text-secondary">{label}</label>}
      <button ref={triggerRef} id={selectId} type="button" role="combobox" aria-expanded={isOpen} aria-haspopup="listbox"
        // `role="combobox"` requires aria-controls as well as aria-expanded;
        // without it assistive tech cannot find the popup it opens.
        aria-controls={`${selectId}-listbox`}
        disabled={disabled} onClick={toggle} onKeyDown={handleKeyDown}
        className={cn("relative w-full h-8 px-2 pr-7 bg-bg-tertiary border border-border-default text-sm text-text-primary text-left",
          "focus:outline-none focus:border-accent-primary focus-ring transition-colors cursor-pointer",
          "disabled:opacity-50 disabled:cursor-not-allowed", className)}>
        <span className="block truncate">{selectedOption ? selectedOption.label : placeholder || "\u00A0"}</span>
        <ChevronDown size={14} className={cn("absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && typeof document !== "undefined" && createPortal(
        <div ref={listboxRef} id={`${selectId}-listbox`} role="listbox" aria-label={typeof label === "string" ? label : undefined} style={dropdownStyle} className="bg-bg-secondary border border-border-default shadow-lg" onKeyDown={handleKeyDown}>
          {searchable && (
            <div className="sticky top-0 bg-bg-secondary border-b border-border-default p-1.5 z-10">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input ref={searchRef} type="text" value={search}
                  onChange={(e) => { setSearch(e.target.value); setFocusedIndex(0); }}
                  onKeyDown={handleKeyDown} placeholder={searchPlaceholder}
                  className="w-full h-7 pl-7 pr-2 bg-bg-tertiary border border-border-default text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary focus-ring" />
              </div>
            </div>
          )}
          <div className="overflow-y-auto" style={{ maxHeight }}>{renderDropdownContent()}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
