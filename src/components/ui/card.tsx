"use client";

import { cn } from "@/lib/utils";
import type { KeyboardEvent, ReactNode } from "react";

interface CardProps {
  title?: string;
  padding?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  /** Accessible name for the activatable form. Falls back to `title`.
   * Supply it when a clickable card carries no `title`, because a screen
   * reader would otherwise announce the whole card body as the name. */
  clickLabel?: string;
}

export function Card({ title, padding = true, className, children, onClick, clickLabel }: CardProps) {
  // A clickable card used to be a bare `<div onClick>`: not focusable, not in
  // the tab order, inert to Enter/Space. Every card-as-navigation surface was
  // therefore unreachable without a pointer. The activatable form now carries
  // real button semantics; the presentational form stays a plain div.
  const interactive = Boolean(onClick);
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick?.();
  };

  return (
    <div
      className={cn(
        "bg-bg-secondary border border-border-default",
        interactive && "cursor-pointer hover:border-border-strong transition-colors focus-ring",
        className
      )}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      aria-label={interactive ? (clickLabel ?? title) : undefined}
    >
      {title && (
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
        </div>
      )}
      <div className={cn(padding && "p-3")}>{children}</div>
    </div>
  );
}
