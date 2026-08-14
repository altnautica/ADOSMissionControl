"use client";

/**
 * @module nodes/NodeContextMenu
 * @description The right-click / overflow / Shift+F10 menu for any node. A
 * portal `menu` anchored at the click coordinates, with roving-tabindex arrow
 * navigation, Escape-to-close, and click-outside dismissal. Every item declares
 * a `when` predicate so the menu is profile-adaptive: an item that does not
 * apply is HIDDEN, not disabled ("Open in cockpit" simply does not appear on a
 * ground-station or workstation).
 *
 * Recognition + Org items are pure presentation overlay (node-personalization
 * store, no network). Nav + Lifecycle touch real state (selection, routing,
 * unpair) via the flows the sidebar already owns.
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useUiStore } from "@/stores/ui-store";
import {
  Bell,
  BellOff,
  Copy,
  FolderPlus,
  Globe,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plane,
  RotateCcw,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  Tag,
  Type,
  Unplug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  NODE_SWATCHES,
  swatchVar,
  type NodeSwatch,
} from "@/lib/nodes/node-profile";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { effProfileForNode } from "./NodeRow";
import { NodeDotEditor } from "./NodeDotEditor";
import { isFcReachable } from "@/lib/agent/mavlink-link";

interface NodeContextMenuProps {
  node: FleetNodeEntry;
  x: number;
  y: number;
  /** Tear the menu down. */
  onClose: () => void;
  /** Select + connect the node (same as clicking its row). */
  onOpen: (node: FleetNodeEntry) => void;
  /** Forget / unpair the node across every source (network + stores). */
  onForget: (node: FleetNodeEntry) => void;
}

/** The active inline text-edit mode inside the floating panel. */
type InputMode = "label" | "icon" | "badge" | "group" | null;

const MENU_WIDTH = 208;
const VIEWPORT_GAP = 8;

export function NodeContextMenu({
  node,
  x,
  y,
  onClose,
  onOpen,
  onForget,
}: NodeContextMenuProps) {
  const t = useTranslations("nodeConsole");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const deviceId = node.deviceId;
  const effProfile = effProfileForNode(node);
  const cockpitEligible =
    (effProfile === "drone" || effProfile === "flight-controller") &&
    isFcReachable({
      fcConnected: node.fcConnected,
      fcVariant: node.fcVariant,
      transportOpen: node.transportOpen,
    });
  const host = node.mdnsHost || node.lastIp || null;

  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[deviceId],
  );
  const setColor = useNodePersonalizationStore((s) => s.setColor);
  const setLabel = useNodePersonalizationStore((s) => s.setLabel);
  const setIcon = useNodePersonalizationStore((s) => s.setIcon);
  const setPinned = useNodePersonalizationStore((s) => s.setPinned);
  const setGroup = useNodePersonalizationStore((s) => s.setGroup);
  const setBadge = useNodePersonalizationStore((s) => s.setBadge);
  const setMuted = useNodePersonalizationStore((s) => s.setMuted);
  const reset = useNodePersonalizationStore((s) => s.reset);
  const hasOverlay = !!personalization;

  const [colorOpen, setColorOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>(null);
  const [inputValue, setInputValue] = useState("");
  const [dotEditorOpen, setDotEditorOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pos, setPos] = useState({ left: x, top: y });

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // The floating panel (menu list or an input row) is hidden while a modal
  // sub-surface (dot editor / forget confirm) owns the screen, but the
  // component stays mounted to host that modal.
  const showFloating = !dotEditorOpen && !confirmOpen;

  // Remember what had focus so Escape / close returns the operator there.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
  }, []);

  const closeMenu = useCallback(() => {
    openerRef.current?.focus?.();
    onClose();
  }, [onClose]);

  // Clamp the panel inside the viewport once it has measured its own height.
  // This is the sanctioned measure-then-position use of useLayoutEffect (the
  // element's real size is only known after it paints).
  useLayoutEffect(() => {
    if (!showFloating) return;
    const el = panelRef.current;
    const height = el?.offsetHeight ?? 0;
    const width = el?.offsetWidth ?? MENU_WIDTH;
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - VIEWPORT_GAP) {
      left = window.innerWidth - width - VIEWPORT_GAP;
    }
    if (top + height > window.innerHeight - VIEWPORT_GAP) {
      top = window.innerHeight - height - VIEWPORT_GAP;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({
      left: Math.max(VIEWPORT_GAP, left),
      top: Math.max(VIEWPORT_GAP, top),
    });
  }, [x, y, showFloating, colorOpen, inputMode]);

  // Focus the first menu item on open; focus the input when an input mode opens.
  useEffect(() => {
    if (!showFloating) return;
    if (inputMode) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    const first = panelRef.current?.querySelector<HTMLElement>(
      '[data-menuitem="true"]',
    );
    first?.focus();
  }, [showFloating, inputMode, colorOpen]);

  // Click-outside dismissal, only while the floating panel is visible (a modal
  // sub-surface owns its own dismissal).
  useEffect(() => {
    if (!showFloating) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showFloating, closeMenu]);

  // Roving arrow navigation over the visible menu items.
  const moveFocus = useCallback((delta: 1 | -1) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[data-menuitem="true"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    let next = current + delta;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    items[next]?.focus();
  }, []);

  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1);
          break;
        case "Home": {
          e.preventDefault();
          const items = panelRef.current?.querySelectorAll<HTMLElement>(
            '[data-menuitem="true"]',
          );
          items?.[0]?.focus();
          break;
        }
        case "End": {
          e.preventDefault();
          const items = panelRef.current?.querySelectorAll<HTMLElement>(
            '[data-menuitem="true"]',
          );
          items?.[items.length - 1]?.focus();
          break;
        }
        case "Escape":
          e.preventDefault();
          closeMenu();
          break;
      }
    },
    [moveFocus, closeMenu],
  );

  function openInput(mode: Exclude<InputMode, null>, seed: string) {
    setColorOpen(false);
    setInputValue(seed);
    setInputMode(mode);
  }

  function submitInput() {
    if (!inputMode) return;
    const value = inputValue.trim();
    switch (inputMode) {
      case "label":
        setLabel(deviceId, value || undefined);
        break;
      case "icon":
        setIcon(deviceId, value || undefined);
        break;
      case "badge":
        setBadge(deviceId, value || undefined);
        break;
      case "group":
        setGroup(deviceId, value || undefined);
        break;
    }
    closeMenu();
  }

  function chooseColor(color: NodeSwatch | undefined) {
    setColor(deviceId, color);
    closeMenu();
  }

  function copy(text: string, message: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast(message, "success"))
      .catch(() => toast(t("contextMenu.copyFailed"), "error"));
    closeMenu();
  }

  function openCockpit() {
    // The cockpit is a node-detail tab now (not a route). Request the Cockpit
    // tab via the reactive pending-tab channel: NodeDetailPanel doesn't remount
    // when the selected node changes, so setLastTab alone wouldn't take (and
    // would get clobbered by the last-tab-persist effect).
    useUiStore.getState().setPendingDetailTab("cockpit");
    onOpen(node);
    closeMenu();
  }

  const inputTitles: Record<Exclude<InputMode, null>, string> = {
    label: t("contextMenu.rename"),
    icon: t("contextMenu.setInitials"),
    badge: t("contextMenu.customBadge"),
    group: t("contextMenu.addToGroup"),
  };
  const inputMax: Record<Exclude<InputMode, null>, number> = {
    label: 40,
    icon: 2,
    badge: 6,
    group: 24,
  };

  return (
    <>
      {showFloating && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={t("contextMenu.menuLabel", { node: node.name })}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
          className="fixed z-[2000] rounded border border-border-default bg-bg-secondary py-1 shadow-lg"
        >
          {inputMode ? (
            <div className="px-2 py-1.5">
              <label
                htmlFor="node-personalize-input"
                className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary"
              >
                {inputTitles[inputMode]}
              </label>
              <input
                id="node-personalize-input"
                ref={inputRef}
                value={inputValue}
                maxLength={inputMax[inputMode]}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitInput();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInputMode(null);
                  }
                }}
                className="w-full rounded border border-accent-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  data-menuitem="true"
                  onClick={() => setInputMode(null)}
                  className="rounded px-2 py-1 text-[11px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  data-menuitem="true"
                  onClick={submitInput}
                  className="rounded bg-accent-primary/15 px-2 py-1 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/25"
                >
                  {tCommon("save")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Recognition */}
              <MenuItem
                icon={<Palette size={13} />}
                label={t("contextMenu.setTileColour")}
                onClick={() => setColorOpen((v) => !v)}
                expanded={colorOpen}
              />
              {colorOpen && (
                <div
                  className="flex flex-wrap items-center gap-1.5 px-3 py-1.5"
                  role="group"
                  aria-label={t("contextMenu.tileColours")}
                >
                  <SwatchChip
                    active={!personalization?.color}
                    label={t("contextMenu.defaultColour")}
                    onClick={() => chooseColor(undefined)}
                  />
                  {NODE_SWATCHES.map((swatch) => (
                    <SwatchChip
                      key={swatch}
                      swatch={swatch}
                      active={personalization?.color === swatch}
                      label={swatch}
                      onClick={() => chooseColor(swatch)}
                    />
                  ))}
                </div>
              )}
              <MenuItem
                icon={<Pencil size={13} />}
                label={t("contextMenu.rename")}
                onClick={() =>
                  openInput("label", personalization?.label ?? node.name)
                }
              />
              <MenuItem
                icon={<Type size={13} />}
                label={t("contextMenu.setInitials")}
                onClick={() => openInput("icon", personalization?.icon ?? "")}
              />
              <MenuItem
                icon={<SlidersHorizontal size={13} />}
                label={t("contextMenu.configureDots")}
                onClick={() => setDotEditorOpen(true)}
              />

              <Divider />

              {/* Org */}
              <MenuItem
                icon={
                  personalization?.pinned ? (
                    <PinOff size={13} />
                  ) : (
                    <Pin size={13} />
                  )
                }
                label={
                  personalization?.pinned
                    ? t("contextMenu.unpin")
                    : t("contextMenu.pin")
                }
                onClick={() => {
                  setPinned(deviceId, !personalization?.pinned);
                  closeMenu();
                }}
              />
              <MenuItem
                icon={<FolderPlus size={13} />}
                label={t("contextMenu.addToGroup")}
                onClick={() =>
                  openInput("group", personalization?.group ?? "")
                }
              />
              <MenuItem
                icon={<Tag size={13} />}
                label={t("contextMenu.customBadge")}
                onClick={() =>
                  openInput("badge", personalization?.badge ?? "")
                }
              />

              <Divider />

              {/* Nav */}
              <MenuItem
                icon={<SquareArrowOutUpRight size={13} />}
                label={t("contextMenu.open")}
                onClick={() => {
                  onOpen(node);
                  closeMenu();
                }}
              />
              {cockpitEligible && (
                <MenuItem
                  icon={<Plane size={13} />}
                  label={t("contextMenu.openInCockpit")}
                  onClick={openCockpit}
                />
              )}
              <MenuItem
                icon={<Copy size={13} />}
                label={t("contextMenu.copyNodeId")}
                onClick={() => copy(deviceId, t("contextMenu.nodeIdCopied"))}
              />
              {host && (
                <MenuItem
                  icon={<Globe size={13} />}
                  label={t("contextMenu.copyHost")}
                  onClick={() => copy(host, t("contextMenu.hostCopied"))}
                />
              )}

              <Divider />

              {/* Lifecycle */}
              <MenuItem
                icon={
                  personalization?.muted ? (
                    <Bell size={13} />
                  ) : (
                    <BellOff size={13} />
                  )
                }
                label={
                  personalization?.muted
                    ? t("contextMenu.unmuteAlerts")
                    : t("contextMenu.muteAlerts")
                }
                onClick={() => {
                  setMuted(deviceId, !personalization?.muted);
                  closeMenu();
                }}
              />
              {hasOverlay && (
                <MenuItem
                  icon={<RotateCcw size={13} />}
                  label={t("contextMenu.resetPersonalization")}
                  onClick={() => {
                    reset(deviceId);
                    toast(t("contextMenu.personalizationReset"), "info");
                    closeMenu();
                  }}
                />
              )}
              <MenuItem
                icon={<Unplug size={13} />}
                label={t("contextMenu.forget")}
                danger
                onClick={() => setConfirmOpen(true)}
              />
            </>
          )}
        </div>
      )}

      <NodeDotEditor
        deviceId={deviceId}
        effProfile={effProfile}
        open={dotEditorOpen}
        onClose={() => {
          setDotEditorOpen(false);
          closeMenu();
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={t("contextMenu.forgetTitle")}
        message={t("contextMenu.forgetMessage", { node: node.name })}
        confirmLabel={t("contextMenu.forget")}
        variant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          reset(deviceId);
          onForget(node);
          setConfirmOpen(false);
          closeMenu();
        }}
      />
    </>
  );
}

function MenuItem({
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

function SwatchChip({
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

function Divider() {
  return <div className="my-1 border-t border-border-default" aria-hidden />;
}
