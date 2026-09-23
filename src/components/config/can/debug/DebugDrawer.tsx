"use client";

/**
 * @module DebugDrawer
 * @description Right-side collapsible debug drawer for the DroneCAN flash
 * page and the CAN configuration page. Composes the state-machine ribbon,
 * frame log, byte counter, RPC trace, node status timeline and bus health
 * gauges.
 *
 * Behavior:
 *  - mode="flash"  → state ribbon always rendered; drawer opens by default.
 *  - mode="config" → state ribbon hidden unless an OTA is mid-flight (state
 *                    not IDLE); drawer closed by default.
 *
 * The drawer is uncontrolled by default but can be controlled by parent
 * components via `open` + `onOpenChange` props.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ChevronLeft, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClockTick } from "@/lib/agent/freshness";
import { useDroneCanFlashStore, useDroneCanBusStore } from "@/stores/dronecan";
import { StateMachineRibbon } from "./StateMachineRibbon";
import { FrameLogPanel } from "./FrameLogPanel";
import { FlashByteCounter } from "./FlashByteCounter";
import { RpcTraceTable } from "./RpcTraceTable";
import { NodeStatusTimeline } from "./NodeStatusTimeline";
import { BusHealthGauges } from "./BusHealthGauges";

export interface DebugDrawerProps {
  /**
   * Render mode. "flash" surfaces the ribbon at all times; "config" hides
   * the ribbon unless an OTA is in progress.
   */
  mode: "flash" | "config";
  /** Controlled open state. When omitted the drawer manages its own state. */
  open?: boolean;
  /** Controlled open-change callback. */
  onOpenChange?: (next: boolean) => void;
  /** Optional className passthrough for the outer aside element. */
  className?: string;
}

const LIVE_WINDOW_MS = 2_000;

export function DebugDrawer({
  mode,
  open: openProp,
  onOpenChange,
  className,
}: DebugDrawerProps) {
  const t = useTranslations("canConfig.debug");
  const defaultOpen = mode === "flash";
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const flashState = useDroneCanFlashStore((s) => s.state);
  const lastFrameAt = useDroneCanBusStore((s) => s.lastFrameAt);
  // Re-evaluate the "live" indicator every second so it goes out when the
  // bus falls silent, not only when the store next changes.
  useClockTick();

  const otaActive = flashState !== "IDLE";
  const showRibbon = mode === "flash" || otaActive;
  const showByteCounter = otaActive;
  // "live" = a CAN frame arrived within the last LIVE_WINDOW_MS.
  const live = lastFrameAt !== null && Date.now() - lastFrameAt < LIVE_WINDOW_MS;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-0 top-1/3 z-30 flex flex-col items-center gap-1 px-1.5 py-3 bg-bg-secondary border border-r-0 border-border-default rounded-l text-text-secondary hover:text-text-primary",
          className,
        )}
        aria-label={t("title")}
        data-testid="debug-drawer-toggle-open"
      >
        <ChevronLeft size={14} />
        <span className="vertical-writing text-[10px] uppercase tracking-wider font-semibold [writing-mode:vertical-rl]">
          {t("title")}
        </span>
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "fixed right-0 top-0 bottom-0 z-30 w-[420px] max-w-[90vw] bg-bg-secondary border-l border-border-default flex flex-col shadow-2xl",
        className,
      )}
      data-testid="debug-drawer"
      data-mode={mode}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-accent-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">
            {t("title")}
          </span>
          {live && (
            <span
              className="flex items-center gap-1 text-[10px] text-status-success"
              data-testid="debug-drawer-live"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
              {t("live")}
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default rounded hover:bg-bg-tertiary text-text-secondary"
          aria-label={t("collapse")}
          data-testid="debug-drawer-toggle-close"
        >
          <ChevronRight size={10} />
          {t("collapse")}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto divide-y divide-border-default">
        {showRibbon && (
          <section className="px-2 py-2" data-testid="debug-drawer-ribbon">
            <StateMachineRibbon />
          </section>
        )}

        {showByteCounter && (
          <section data-testid="debug-drawer-byte-counter">
            <FlashByteCounter />
          </section>
        )}

        <section
          className="h-[360px] flex flex-col"
          data-testid="debug-drawer-frame-log"
        >
          <FrameLogPanel />
        </section>

        <section data-testid="debug-drawer-rpc-trace">
          <RpcTraceTable />
        </section>

        <section data-testid="debug-drawer-node-status-timeline">
          <NodeStatusTimeline />
        </section>

        <section data-testid="debug-drawer-bus-health-gauges">
          <BusHealthGauges />
        </section>
      </div>
    </aside>
  );
}
