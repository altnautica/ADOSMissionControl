"use client";

/**
 * @module UplinkPriorityList
 * @description Phase 3 drag-reorderable list of uplink interfaces.
 * Uses native HTML5 drag-and-drop (no npm dep). The active interface gets a
 * highlight badge. Parent owns the array and mutation; this component fires
 * onChange with the new order after each drop.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";

interface UplinkPriorityListProps {
  priority: string[];
  active: string | null;
  onChange: (priority: string[]) => void;
  labelFor?: (iface: string) => string;
  disabled?: boolean;
}

function defaultLabel(iface: string): string {
  switch (iface) {
    case "ethernet":
      return "Ethernet";
    case "wifi_client":
      return "WiFi Client";
    case "modem_4g":
      return "4G Modem";
    case "ap":
      return "Access Point";
    default:
      return iface;
  }
}

export function UplinkPriorityList({
  priority,
  active,
  onChange,
  labelFor,
  disabled,
}: UplinkPriorityListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const label = labelFor ?? defaultLabel;

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs some data set to start dragging
    try {
      e.dataTransfer.setData("text/plain", String(index));
    } catch {
      // ignore
    }
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    e.dataTransfer.dropEffect = "move";
    if (hoverIndex !== index) setHoverIndex(index);
  };

  const handleDragLeave = () => {
    setHoverIndex(null);
  };

  const handleDrop = (dropIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (dragIndex == null || dragIndex === dropIndex) {
      setDragIndex(null);
      setHoverIndex(null);
      return;
    }
    const next = [...priority];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    setDragIndex(null);
    setHoverIndex(null);
    onChange(next);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setHoverIndex(null);
  };

  if (priority.length === 0) {
    return (
      <div className="rounded border border-dashed border-border-primary/60 px-3 py-4 text-center text-xs text-text-tertiary">
        No uplinks configured.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {priority.map((iface, idx) => {
        const isActive = iface === active;
        const isHovered = hoverIndex === idx && dragIndex !== null && dragIndex !== idx;
        const isDragging = dragIndex === idx;
        return (
          <li
            key={iface}
            draggable={!disabled}
            onDragStart={handleDragStart(idx)}
            onDragOver={handleDragOver(idx)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "flex items-center gap-2 rounded border px-3 py-2 transition-colors",
              isHovered
                ? "border-accent-primary bg-accent-primary/10"
                : "border-border-primary/40 bg-bg-tertiary",
              isDragging && "opacity-50",
              !disabled && "cursor-grab",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <GripVertical
              size={14}
              className="text-text-tertiary"
              aria-hidden="true"
            />
            <span className="flex-1 text-sm text-text-primary">
              {label(iface)}
            </span>
            <span className="font-mono text-[10px] text-text-tertiary">
              {iface}
            </span>
            {isActive ? (
              <span className="rounded border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success">
                Active
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
