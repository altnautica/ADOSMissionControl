"use client";

/**
 * @module PeripheralsTab
 * @description Peripheral device management with category filtering.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ScanLine, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { CategoryFilter } from "./shared/CategoryFilter";

const statusColor: Record<string, string> = {
  ok: "bg-status-success",
  warning: "bg-status-warning",
  error: "bg-status-error",
  offline: "bg-text-tertiary",
};

const categoryBadgeColor: Record<string, string> = {
  sensor: "bg-accent-primary/15 text-accent-primary",
  camera: "bg-status-success/15 text-status-success",
  video: "bg-status-warning/15 text-status-warning",
  gimbal: "bg-purple-500/15 text-purple-400",
  compute: "bg-text-tertiary/15 text-text-secondary",
};

export function PeripheralsTab() {
  const t = useTranslations("peripherals");
  const connected = useAgentStore((s) => s.connected);
  const peripherals = useAgentStore((s) => s.peripherals);
  const fetchPeripherals = useAgentStore((s) => s.fetchPeripherals);
  const scanPeripherals = useAgentStore((s) => s.scanPeripherals);
  const [scanning, setScanning] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    if (connected) fetchPeripherals();
  }, [connected, fetchPeripherals]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    peripherals.forEach((p) => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return [
      { id: "all", label: "All", count: peripherals.length },
      ...Object.entries(counts).map(([id, count]) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        count,
      })),
    ];
  }, [peripherals]);

  const filtered = activeCategory === "all"
    ? peripherals
    : peripherals.filter((p) => p.category === activeCategory);

  async function handleScan() {
    setScanning(true);
    await scanPeripherals();
    setScanning(false);
  }

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  return (
    <div className="p-4 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {t("title")}
        </h3>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ScanLine size={12} />
          )}
          {scanning ? t("scanning") : t("scanNow")}
        </button>
      </div>

      <CategoryFilter
        categories={categories}
        active={activeCategory}
        onChange={setActiveCategory}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((peripheral) => (
          <div
            key={peripheral.name}
            className="border border-border-default rounded-lg p-3 bg-bg-secondary"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">
                {peripheral.name}
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    statusColor[peripheral.status] ?? "bg-text-tertiary"
                  )}
                />
                <span className="text-[10px] text-text-tertiary uppercase">
                  {peripheral.status}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-2">
              <span
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-medium rounded",
                  categoryBadgeColor[peripheral.category] ?? "bg-bg-tertiary text-text-tertiary"
                )}
              >
                {peripheral.category}
              </span>
              <span className="text-[10px] text-text-tertiary font-mono">
                {peripheral.type}
              </span>
            </div>

            <div className="space-y-1 text-xs text-text-tertiary">
              <div className="flex justify-between">
                <span>{t("bus")}</span>
                <span className="text-text-secondary font-mono">
                  {peripheral.bus}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("address")}</span>
                <span className="text-text-secondary font-mono">
                  {peripheral.address}
                </span>
              </div>
              {peripheral.rate_hz > 0 && (
                <div className="flex justify-between">
                  <span>{t("rate")}</span>
                  <span className="text-text-secondary font-mono">
                    {peripheral.rate_hz} Hz
                  </span>
                </div>
              )}
            </div>

            <div className="mt-2 pt-2 border-t border-border-default">
              <span className="text-[10px] text-text-tertiary">{t("lastReading")}</span>
              <p className="text-xs text-text-secondary font-mono mt-0.5">
                {peripheral.last_reading}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
