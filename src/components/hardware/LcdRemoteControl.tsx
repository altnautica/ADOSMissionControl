"use client";

/**
 * @module LcdRemoteControl
 * @description Remote-control card for the agent's local LCD. Four
 * large icon buttons mirror the on-LCD bottom tab bar: Dashboard,
 * Video, Settings, More. Tapping a button optimistically highlights
 * the new active page and fires `POST /api/v1/display/page`. The
 * optimistic state rolls back if the agent rejects the request.
 *
 * Buttons disable when the agent is offline (no live heartbeat for
 * more than the freshness threshold).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Video,
  Settings,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { livenessFromTimestamp } from "@/lib/nodes/presence";

type PageId = "dashboard" | "video" | "settings" | "more";

interface PageButtonDef {
  id: PageId;
  labelKey: "pageDashboard" | "pageVideo" | "pageSettings" | "pageMore";
  icon: LucideIcon;
}

const PAGES: PageButtonDef[] = [
  { id: "dashboard", labelKey: "pageDashboard", icon: LayoutDashboard },
  { id: "video", labelKey: "pageVideo", icon: Video },
  { id: "settings", labelKey: "pageSettings", icon: Settings },
  { id: "more", labelKey: "pageMore", icon: MoreHorizontal },
];

export function LcdRemoteControl() {
  const display = useAgentCapabilitiesStore((s) => s.display);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);
  const client = useAgentConnectionStore((s) => s.client);
  const lastUpdatedAt = useAgentSystemStore((s) => s.lastUpdatedAt);
  const t = useTranslations("hardware.lcdRemoteControl");
  const { toast } = useToast();

  // Optimistic active-page override. Cleared when the heartbeat
  // confirms the new page (or the request fails and we roll back).
  const [optimisticPage, setOptimisticPage] = useState<PageId | null>(null);
  const [pending, setPending] = useState(false);

  // When the heartbeat catches up, drop the optimistic shadow.
  useEffect(() => {
    if (!optimisticPage) return;
    if (display?.activePage === optimisticPage) {
      setOptimisticPage(null);
    }
  }, [display?.activePage, optimisticPage]);

  if (!loaded || !display || display.type === "none") {
    return null;
  }

  const activePage = optimisticPage ?? display.activePage ?? null;
  // A heartbeat that was never stamped leaves the controls usable; one that
  // stamped and then went quiet past the stale threshold disables them.
  const offline = !!lastUpdatedAt && livenessFromTimestamp(lastUpdatedAt) !== "live";
  const disabled = !client || offline || pending;

  const onPick = async (id: PageId) => {
    if (!client || pending) return;
    const previous = display.activePage ?? null;
    setOptimisticPage(id);
    setPending(true);
    try {
      await client.setDisplayPage(id);
      // Heartbeat will confirm; optimistic shadow drops in the effect.
    } catch (err) {
      // Roll back the optimistic change.
      setOptimisticPage(previous as PageId | null);
      const msg = err instanceof Error ? err.message : t("switchFailed");
      toast(msg, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded border border-border-default bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <h2 className="text-sm font-display font-semibold text-text-primary">
          {t("title")}
        </h2>
        {offline ? (
          <span className="rounded bg-status-warning/15 px-2 py-0.5 text-[11px] font-medium text-status-warning">
            {t("agentOffline")}
          </span>
        ) : null}
      </header>
      <p className="px-4 pt-3 text-xs text-text-secondary">{t("description")}</p>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        {PAGES.map((p) => {
          const Icon = p.icon;
          const active = activePage === p.id;
          const button = (
            <button
              key={p.id}
              type="button"
              data-active={active}
              data-page={p.id}
              onClick={() => onPick(p.id)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded border px-3 py-4 text-xs font-medium transition-colors",
                active
                  ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
                  : "border-border-default bg-bg-tertiary text-text-secondary hover:border-accent-primary/40 hover:text-text-primary",
                disabled && "cursor-not-allowed opacity-60",
              )}
              aria-pressed={active}
            >
              <Icon size={20} />
              <span>{t(p.labelKey)}</span>
            </button>
          );
          if (offline) {
            return (
              <Tooltip key={p.id} content={t("agentOffline")}>
                {button}
              </Tooltip>
            );
          }
          return button;
        })}
      </div>
    </section>
  );
}
