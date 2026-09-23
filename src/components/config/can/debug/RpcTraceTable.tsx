"use client";

/**
 * @module RpcTraceTable
 * @description Virtualized list of recent DroneCAN RPC events. Reads from
 * the RPC trace store (cap 512). Filters by node ID, type name, or
 * errors-only. Click a row to reveal the decoded payload JSON tree below
 * the row body.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertOctagon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDroneCanRpcTraceStore,
  type RpcEvent,
} from "@/stores/dronecan/rpc-trace-store";

const ROW_HEIGHT = 24;

interface LocalFilters {
  nodeIdInput: string;
  typeInput: string;
  errorsOnly: boolean;
}

const INITIAL_FILTERS: LocalFilters = {
  nodeIdInput: "",
  typeInput: "",
  errorsOnly: false,
};

function dirArrow(d: RpcEvent["direction"]): string {
  return d === "in" ? "←" : "→";
}

function nodePair(ev: RpcEvent): string {
  if (ev.srcNodeId !== undefined && ev.dstNodeId !== undefined) {
    return ev.direction === "out"
      ? `${ev.srcNodeId}→${ev.dstNodeId}`
      : `${ev.srcNodeId}←${ev.dstNodeId}`;
  }
  if (ev.srcNodeId !== undefined) return String(ev.srcNodeId);
  if (ev.dstNodeId !== undefined) return String(ev.dstNodeId);
  return "—";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => (typeof val === "bigint" ? val.toString() : val),
      2,
    );
  } catch {
    return String(v);
  }
}

function applyFilters(events: ReadonlyArray<RpcEvent>, f: LocalFilters): RpcEvent[] {
  const nodeNum = f.nodeIdInput.trim() === "" ? null : Number(f.nodeIdInput);
  const typeNeedle = f.typeInput.trim().toLowerCase();
  return events.filter((ev) => {
    if (f.errorsOnly && ev.ok) return false;
    if (nodeNum !== null && !Number.isNaN(nodeNum)) {
      if (ev.srcNodeId !== nodeNum && ev.dstNodeId !== nodeNum) return false;
    }
    if (typeNeedle.length > 0) {
      if (!ev.dataTypeName.toLowerCase().includes(typeNeedle)) return false;
    }
    return true;
  });
}

export function RpcTraceTable() {
  const t = useTranslations("canConfig.debug.rpcTrace");
  const tCol = useTranslations("canConfig.debug.rpcTrace.column");

  const ring = useDroneCanRpcTraceStore((s) => s.events);
  const version = useDroneCanRpcTraceStore((s) => s._version);

  const [filters, setFilters] = useState<LocalFilters>(INITIAL_FILTERS);
  // Keyed by the event object itself: row indices shift as events arrive.
  const [expanded, setExpanded] = useState<RpcEvent | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const all = ring.toArray();
    const filtered = applyFilters(all, filters);
    return filtered.slice().reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, filters, version]);

  const firstT = visible.length > 0 ? visible[visible.length - 1].t : 0;

  const virt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const onClickRow = useCallback((ev: RpcEvent) => {
    setExpanded((prev) => (prev === ev ? null : ev));
  }, []);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-default">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">
          {t("title")}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Node"
            value={filters.nodeIdInput}
            onChange={(e) =>
              setFilters((f) => ({ ...f, nodeIdInput: e.target.value }))
            }
            className="w-12 px-1.5 py-0.5 text-[10px] bg-bg-tertiary border border-border-default rounded text-text-primary"
            aria-label="Filter by node"
          />
          <input
            type="text"
            placeholder="Type"
            value={filters.typeInput}
            onChange={(e) =>
              setFilters((f) => ({ ...f, typeInput: e.target.value }))
            }
            className="w-24 px-1.5 py-0.5 text-[10px] bg-bg-tertiary border border-border-default rounded text-text-primary"
            aria-label="Filter by type"
          />
          <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={filters.errorsOnly}
              onChange={(e) =>
                setFilters((f) => ({ ...f, errorsOnly: e.target.checked }))
              }
              className="accent-status-error"
            />
            <AlertOctagon size={10} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-[60px_24px_140px_70px_60px_60px] gap-x-2 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-text-tertiary border-b border-border-default">
        <span>{tCol("time")}</span>
        <span>{tCol("dir")}</span>
        <span>{tCol("type")}</span>
        <span>{tCol("node")}</span>
        <span>{tCol("latency")}</span>
        <span>{tCol("status")}</span>
      </div>

      <div
        ref={parentRef}
        className="h-[200px] overflow-y-auto"
        data-testid="rpc-trace-scroll"
      >
        {visible.length === 0 ? (
          <div className="text-center py-6 text-[11px] text-text-tertiary">
            {t("empty")}
          </div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((vi) => {
              const ev = visible[vi.index];
              const isOpen = expanded === ev;
              const tRel = firstT ? ev.t - firstT : 0;
              return (
                <div
                  key={vi.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                  data-rpc-row="true"
                >
                  <button
                    onClick={() => onClickRow(ev)}
                    className={cn(
                      "grid grid-cols-[60px_24px_140px_70px_60px_60px] gap-x-2 px-2 py-0.5 text-[11px] font-mono w-full text-left hover:bg-bg-tertiary border-b border-border-default",
                      !ev.ok && "text-status-error",
                      ev.ok && ev.kind === "request" && "text-accent-primary",
                      ev.ok && ev.kind === "response" && "text-text-secondary",
                      ev.ok && ev.kind === "broadcast" && "text-text-tertiary",
                      ev.ok && (ev.kind === "file_read_req" || ev.kind === "file_read_resp") && "text-status-warning",
                    )}
                  >
                    <span className="text-text-tertiary">+{tRel}ms</span>
                    <span>{dirArrow(ev.direction)}</span>
                    <span className="truncate flex items-center gap-1">
                      {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      {ev.dataTypeName}
                    </span>
                    <span>{nodePair(ev)}</span>
                    <span>{ev.latencyMs !== undefined ? `${ev.latencyMs}ms` : ""}</span>
                    <span>{ev.ok ? "ok" : "err"}</span>
                  </button>
                  {isOpen && ev.decoded !== undefined && (
                    <pre className="px-3 py-2 bg-bg-primary border-b border-border-default text-[10px] font-mono whitespace-pre-wrap text-text-secondary overflow-x-auto">
                      {safeStringify(ev.decoded)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
