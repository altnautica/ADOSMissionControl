"use client";

/**
 * @module MeshNeighborsTable
 * @description Semantic table of batman-adv neighbors with TQ + last-seen.
 * Sorted by TQ descending so stronger peers are at the top.
 * @license GPL-3.0-only
 */

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";

export function MeshNeighborsTable() {
  const t = useTranslations("hardware.mesh");
  const neighbors = useGroundStationStore((s) => s.mesh.neighbors);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const sorted = useMemo(
    () => [...neighbors].sort((a, b) => b.tq - a.tq),
    [neighbors],
  );

  const moveFocus = (from: number, delta: number) => {
    const next = from + delta;
    if (next < 0 || next >= sorted.length) return;
    rowRefs.current[next]?.focus();
  };

  const onRowKeyDown = (idx: number) => (
    e: React.KeyboardEvent<HTMLTableRowElement>,
  ) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(idx, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(idx, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      rowRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      rowRefs.current[sorted.length - 1]?.focus();
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="p-4 bg-bg-primary border border-border-default/40">
        <div className="text-sm text-text-tertiary italic">{t("noNeighbors")}</div>
      </div>
    );
  }

  return (
    <div className="bg-bg-primary border border-border-default/40">
      <div className="px-4 py-2 text-sm font-medium text-text-primary border-b border-border-default/40">
        {t("neighbors")} ({sorted.length})
      </div>
      <div className="overflow-x-auto">
      <table
        role="table"
        aria-label={t("neighborsAriaLabel")}
        className="w-full text-xs"
      >
        <thead>
          <tr className="text-text-tertiary uppercase tracking-wider">
            <th scope="col" className="px-4 py-2 text-left">{t("colMac")}</th>
            <th scope="col" className="px-4 py-2 text-left">{t("colIface")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colTq")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colLastSeen")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((n, idx) => (
            <tr
              key={`${n.mac}-${n.iface}`}
              ref={(el) => {
                rowRefs.current[idx] = el;
              }}
              tabIndex={idx === 0 ? 0 : -1}
              onKeyDown={onRowKeyDown(idx)}
              className="border-t border-border-default/20 hover:bg-bg-primary focus:outline-none focus:bg-accent-primary/10 focus-visible:ring-1 focus-visible:ring-accent-primary"
            >
              <th scope="row" className="px-4 py-2 text-left font-mono text-text-primary">
                {n.mac}
              </th>
              <td className="px-4 py-2 text-text-secondary">{n.iface}</td>
              <td className="px-4 py-2 text-right font-mono text-text-primary">{n.tq}</td>
              <td className="px-4 py-2 text-right font-mono text-text-secondary">
                {n.last_seen_ms} ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
