"use client";

/**
 * @module nodes/NodeMenuParts
 * @description The building blocks of the node context menu: menu items,
 * colour swatch chips, dividers, the inline personalization input row, and
 * the roving arrow-key navigation over every `data-menuitem` element.
 * @license GPL-3.0-only
 */

import { useCallback, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { swatchVar, type NodeSwatch } from "@/lib/nodes/node-profile";

const MENU_ITEM_SELECTOR = '[data-menuitem="true"]';

/**
 * Arrow / Home / End navigation across the panel's menu items, and Escape to
 * close. Returns the panel's keydown handler.
 */
export function useRovingMenu(
  panelRef: RefObject<HTMLDivElement | null>,
  closeMenu: () => void,
): (e: React.KeyboardEvent) => void {
  return useCallback(
    (e: React.KeyboardEvent) => {
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [],
      );
      const current = items.findIndex((el) => el === document.activeElement);
      let target: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowDown":
          target = items[current + 1 >= items.length ? 0 : current + 1];
          break;
        case "ArrowUp":
          target = items[current - 1 < 0 ? items.length - 1 : current - 1];
          break;
        case "Home":
          target = items[0];
          break;
        case "End":
          target = items[items.length - 1];
          break;
        case "Escape":
          e.preventDefault();
          closeMenu();
          return;
        default:
          return;
      }
      e.preventDefault();
      target?.focus();
    },
    [panelRef, closeMenu],
  );
}

/** The first menu item in the panel, for initial focus. */
export function firstMenuItem(panel: HTMLElement | null): HTMLElement | null {
  return panel?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR) ?? null;
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  expanded,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menuitem="true"
      tabIndex={-1}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors outline-none",
        "focus-visible:bg-bg-tertiary focus:bg-bg-tertiary",
        danger
          ? "text-status-error hover:bg-status-error/10 focus:bg-status-error/10"
          : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function SwatchChip({
  swatch,
  active,
  label,
  onClick,
}: {
  swatch?: NodeSwatch;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-menuitem="true"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full border transition-transform outline-none",
        "hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent-primary",
        active ? "border-text-primary" : "border-border-default",
      )}
      style={
        swatch
          ? { backgroundColor: `var(${swatchVar(swatch)})` }
          : undefined
      }
    >
      {/* Default chip: a diagonal "no colour" cue, never colour-only. */}
      {!swatch && (
        <span
          aria-hidden
          className="block h-3 w-3 rounded-full border border-text-tertiary bg-bg-tertiary"
        />
      )}
    </button>
  );
}

export function Divider() {
  return <div className="my-1 border-t border-border-default" aria-hidden />;
}

/** The inline text input that replaces the menu list while a personalization
 * field (label, initials, badge, group) is being edited. */
export function InputRow({
  title,
  value,
  maxLength,
  inputRef,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  value: string;
  maxLength: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const tCommon = useTranslations("common");
  return (
    <div className="px-2 py-1.5">
      <label
        htmlFor="node-personalize-input"
        className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary"
      >
        {title}
      </label>
      <input
        id="node-personalize-input"
        ref={inputRef}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="w-full rounded border border-accent-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none"
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          data-menuitem="true"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
        >
          {tCommon("cancel")}
        </button>
        <button
          data-menuitem="true"
          onClick={onSubmit}
          className="rounded bg-accent-primary/15 px-2 py-1 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/25"
        >
          {tCommon("save")}
        </button>
      </div>
    </div>
  );
}
