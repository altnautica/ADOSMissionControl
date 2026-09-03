/**
 * @module CollapsibleSection
 * @description Reusable collapsible section with chevron toggle, optional item count badge,
 * and trailing action slot. Used throughout the planner right panel.
 * @license GPL-3.0-only
 */
"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  /** Initial open state (uncontrolled mode). Ignored when `open` is provided. */
  defaultOpen?: boolean;
  /** Controlled open state. When provided, the component is fully controlled. */
  open?: boolean;
  /** Called when the section is toggled. Required for controlled mode. */
  onToggle?: () => void;
  count?: number;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  count,
  trailing,
  children,
  className,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const toggle = isControlled ? onToggle : () => setInternalOpen((v) => !v);

  return (
    <div className={cn("border-b border-border-default", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggle?.()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle?.(); } }}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer focus-ring-inset"
      >
        {open ? (
          <ChevronDown size={12} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-text-tertiary shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex-1 text-left">
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[10px] font-mono text-text-tertiary">({count})</span>
        )}
        {trailing && (
          <div onClick={(e) => e.stopPropagation()}>{trailing}</div>
        )}
      </div>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
