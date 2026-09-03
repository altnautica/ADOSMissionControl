"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { Search, LayoutDashboard, Route, History, Settings, Zap, Battery, Home, Plug, SlidersHorizontal } from "lucide-react";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { useUiStore } from "@/stores/ui-store";
import { useToast } from "@/components/ui/toast";
import { getRegisteredCommands } from "@/lib/command-palette-registry";
import { cn } from "@/lib/utils";


interface CommandAction {
  id: string;
  label: string;
  category: string;
  icon?: React.ReactNode;
  action: () => void;
}

export function CommandPalette() {
  const t = useTranslations("commandPalette");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  // `/analytics` and `/wizard` had entries here and neither route exists under
  // `src/app`, so two localised palette items navigated straight to a 404 from
  // the app's primary command surface. Removed rather than stubbed: a route
  // that was never built is not a navigation target.
  const actions: CommandAction[] = [
    { id: "nav-dashboard", label: t("goToDashboard"), category: t("navigation"), icon: <LayoutDashboard size={14} />, action: () => router.push("/") },
    { id: "nav-plan", label: t("goToPlan"), category: t("navigation"), icon: <Route size={14} />, action: () => router.push("/plan") },
    { id: "nav-history", label: t("goToHistory"), category: t("navigation"), icon: <History size={14} />, action: () => router.push("/flight-logs") },
    { id: "nav-config", label: t("goToConfig"), category: t("navigation"), icon: <Settings size={14} />, action: () => router.push("/config") },
    {
      id: "cmd-connect", label: t("connectDrone"), category: t("commands"), icon: <Plug size={14} />,
      action: () => useConnectDialogStore.getState().openDialog(),
    },
    {
      id: "cmd-rth", label: t("returnToHomeAll"), category: t("commands"), icon: <Home size={14} />,
      action: () => {
        const drones = useFleetStore.getState().drones;
        const inFlight = drones.filter((d) => d.connectionState === "in_flight" || d.connectionState === "armed");
        toast(inFlight.length > 0 ? `RTH command sent to ${inFlight.length} drone${inFlight.length > 1 ? "s" : ""}` : "No active drones to recall");
      },
    },
    {
      id: "cmd-arm", label: t("armVehicle"), category: t("commands"), icon: <Zap size={14} />,
      action: () => {
        useDroneStore.getState().setArmState("armed");
        toast("Arm command sent", "success");
      },
    },
    {
      id: "cmd-bat", label: t("checkBattery"), category: t("commands"), icon: <Battery size={14} />,
      action: () => {
        const drones = useFleetStore.getState().drones;
        if (drones.length === 0) { toast("No drones in fleet"); return; }
        const withBattery = drones.filter((d) => d.battery?.remaining != null);
        if (withBattery.length === 0) { toast("No battery data available"); return; }
        const avg = Math.round(withBattery.reduce((sum, d) => sum + d.battery!.remaining, 0) / withBattery.length);
        toast(`Fleet avg battery: ${avg}% (${withBattery.length} drone${withBattery.length > 1 ? "s" : ""})`);
      },
    },
  ];

  // Build parameter search results from all cached FC params when connected
  const paramActions: CommandAction[] = (() => {
    if (!query || query.length < 2) return [];
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) return [];
    const allNames = protocol.getCachedParameterNames();
    if (allNames.length === 0) return [];
    const parts = query.toLowerCase().split(/\s+/);
    return allNames
      .filter(p => parts.every(part => p.toLowerCase().includes(part)))
      .slice(0, 8)
      .map(p => ({
        id: `param-${p}`,
        label: p,
        category: t("parameters"),
        icon: <SlidersHorizontal size={14} />,
        action: () => {
          // Navigate to dashboard, switch to Parameters tab, pre-fill search filter
          const ui = useUiStore.getState();
          ui.setPendingParamSearch(p);
          ui.setPendingDetailTab("parameters");
          router.push("/");
        },
      }));
  })();

  const filteredActions = query
    ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : actions;
  // Route-contributed commands (e.g. planner verbs) — providers receive the
  // query + path and return already-relevant commands, so they are not
  // re-filtered here (same contract as the param actions below).
  const registeredActions = getRegisteredCommands({ query, pathname });
  // Param actions are already filtered by query parts — don't double-filter
  const filtered = [...filteredActions, ...registeredActions, ...paramActions];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        setOpen(false);
      }
    },
    [open, filtered, selectedIndex]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const categories = [...new Set(filtered.map((a) => a.category))];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh] bg-black/60"
      onClick={() => setOpen(false)}
    >
      {/* The app's primary command surface had no dialog semantics at all: no
          role, no aria-modal, no accessible name, and the result list was a
          flat run of buttons with no selected-option relationship to the
          input. `CockpitCommandPalette` is the in-repo model. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="w-full max-w-md bg-bg-secondary border border-border-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
          <Search size={14} className="text-text-tertiary" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("title")}
            role="combobox"
            aria-expanded={true}
            aria-controls="command-palette-results"
            aria-activedescendant={filtered[selectedIndex] ? `command-palette-${filtered[selectedIndex].id}` : undefined}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <kbd className="text-[10px] text-text-tertiary border border-border-default px-1 py-0.5 font-mono">ESC</kbd>
        </div>
        <div id="command-palette-results" role="listbox" aria-label={t("title")} className="max-h-64 overflow-auto py-1">
          {categories.map((cat) => (
            <div key={cat} role="group" aria-label={cat}>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-tertiary" aria-hidden="true">
                {cat}
              </div>
              {filtered
                .filter((a) => a.category === cat)
                .map((action) => {
                  const idx = filtered.indexOf(action);
                  return (
                    <div
                      key={action.id}
                      id={`command-palette-${action.id}`}
                      role="option"
                      aria-selected={idx === selectedIndex}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                        idx === selectedIndex ? "bg-accent-primary/10 text-accent-primary" : "text-text-primary hover:bg-bg-tertiary"
                      )}
                      onClick={() => {
                        action.action();
                        setOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      {action.icon}
                      {action.label}
                    </div>
                  );
                })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-text-tertiary text-center">{t("noResults")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
