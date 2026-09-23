"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDroneManager } from "@/stores/drone-manager";
import { Radio, Filter, Pause, Play, Download, Trash2, ArrowUpDown } from "lucide-react";
import { RingBuffer } from "@/lib/ring-buffer";
import { MSG_NAMES } from "@/lib/protocol/mavlink-adapter-frame-handlers";
import {
  decodePayload,
  messageName,
  payloadHex,
  tickRates,
  type InspectorMessage,
  type MsgRate,
} from "./mavlink-inspector-data";
import { downloadBlob } from "@/lib/download";

const MAX_MESSAGES = 500;
const ROW_ESTIMATE_PX = 16;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function MavlinkInspectorPanel() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);

  // Frames live in a ring mutated in place; `version` re-renders at most once a frame.
  const [ring] = useState(() => new RingBuffer<InspectorMessage>(MAX_MESSAGES));
  const [version, setVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const [filterMsgId, setFilterMsgId] = useState<string>("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [msgRates, setMsgRates] = useState<{ id: number; hz: number }[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const msgCounterRef = useRef(0);
  const pausedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const ratesRef = useRef<Map<number, MsgRate>>(new Map());

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const protocol = getSelectedProtocol();
    ratesRef.current = new Map();
    if (!protocol?.onMavlinkFrame) return;
    return protocol.onMavlinkFrame((frame) => {
      const rate = ratesRef.current.get(frame.msgId);
      if (rate) rate.count++;
      else ratesRef.current.set(frame.msgId, { count: 1, hz: 0 });
      if (pausedRef.current) return;
      ring.push({ id: msgCounterRef.current++, msgId: frame.msgId, msgName: messageName(frame.msgId), frame });
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setVersion((v) => v + 1);
      });
    });
  }, [selectedDroneId, getSelectedProtocol, ring]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current ?? 0), []);

  // Close a rate window every second so a stopped message decays to 0 Hz.
  useEffect(() => {
    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      tickRates(ratesRef.current, (now - last) / 1000);
      last = now;
      setMsgRates(
        Array.from(ratesRef.current.entries(), ([id, r]) => ({ id, hz: r.hz })).sort((a, b) => b.hz - a.hz),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const filterIds = useMemo(() => {
    if (!filterMsgId.trim()) return null;
    return new Set(
      filterMsgId.split(",").map((s) => {
        const trimmed = s.trim();
        const byName = Object.entries(MSG_NAMES).find(([, name]) => name === trimmed.toUpperCase());
        return byName ? Number(byName[0]) : Number(trimmed);
      }).filter((n) => !isNaN(n))
    );
  }, [filterMsgId]);

  const filtered = useMemo(() => {
    const all = ring.toArray();
    return filterIds ? all.filter((m) => filterIds.has(m.msgId)) : all;
    // `ring` is mutated in place; `version` marks each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, filterIds, version]);

  const virt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => logRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 20,
  });

  useEffect(() => {
    if (autoscroll && filtered.length > 0) virt.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered, autoscroll, virt]);

  const exportLog = useCallback(() => {
    const lines = filtered.map((m) => {
      const time = new Date(m.frame.timestamp).toISOString();
      return `[${time}] RX ${m.msgName}(${m.msgId}) sys=${m.frame.systemId} comp=${m.frame.componentId} seq=${m.frame.sequence} [${payloadHex(m.frame.payload)}]`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    downloadBlob(blob, `mavlink-log-${Date.now()}.txt`);
  }, [filtered]);

  const clear = useCallback(() => {
    ring.clear();
    msgCounterRef.current = 0;
    setExpandedId(null);
    setVersion((v) => v + 1);
  }, [ring]);

  return (
    <div className="h-full flex">
      {/* Sidebar — Message rates */}
      <div className="w-[220px] border-r border-border-default bg-bg-secondary flex-shrink-0 flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border-default">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5"><ArrowUpDown size={12} />Message Rates</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {msgRates.length === 0 ? (
            <p className="p-3 text-[10px] text-text-tertiary italic">{selectedDroneId ? "Waiting for data..." : "Connect a drone"}</p>
          ) : (
            <table className="w-full text-[10px] font-mono">
              <thead><tr className="border-b border-border-default"><th className="text-left px-3 py-1 text-text-tertiary font-normal">Message</th><th className="text-right px-3 py-1 text-text-tertiary font-normal">Hz</th></tr></thead>
              <tbody>
                {msgRates.map(({ id, hz }) => (
                  <tr key={id} className="hover:bg-bg-tertiary cursor-pointer" onClick={() => setFilterMsgId(String(id))}>
                    <td className="px-3 py-0.5 text-text-secondary">{messageName(id)}</td>
                    <td className="px-3 py-0.5 text-right text-accent-primary tabular-nums">{hz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
          <Radio size={14} className="text-text-secondary" />
          <span className="text-xs font-semibold text-text-primary">MAVLink Inspector</span>
          <span className="text-[10px] text-text-tertiary font-mono">{filtered.length} msgs</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <Filter size={12} className="text-text-tertiary" />
            <input type="text" value={filterMsgId} onChange={(e) => setFilterMsgId(e.target.value)} placeholder="Filter: ID or name (comma-sep)" className="bg-bg-tertiary text-text-primary text-[10px] font-mono px-2 py-1 w-[200px] border border-border-default focus:outline-none focus:border-accent-primary placeholder:text-text-tertiary" />
          </div>
          <button onClick={() => setPaused((p) => !p)} className={`flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer ${paused ? "text-status-warning" : "text-text-secondary hover:text-text-primary"}`}>
            {paused ? <Pause size={10} /> : <Play size={10} />}{paused ? "Paused" : "Live"}
          </button>
          <button onClick={exportLog} className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"><Download size={10} />Export</button>
          <button onClick={clear} className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"><Trash2 size={10} />Clear</button>
        </div>

        <div className="flex items-center gap-0 px-4 py-1 border-b border-border-default bg-bg-tertiary text-text-tertiary font-mono text-[10px] leading-4">
          <span className="w-[90px] shrink-0">Time</span><span className="w-[20px] shrink-0">Dir</span><span className="w-[40px] shrink-0 text-right">ID</span>
          <span className="w-[180px] shrink-0 pl-2">Name</span><span className="w-[30px] shrink-0 text-right">Sys</span><span className="w-[35px] shrink-0 text-right">Comp</span>
          <span className="w-[30px] shrink-0 text-right">Seq</span><span className="w-[30px] shrink-0 text-right">Len</span><span className="pl-2 flex-1">Payload</span>
        </div>

        <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[10px] leading-4" onMouseEnter={() => setAutoscroll(false)} onMouseLeave={() => setAutoscroll(true)}>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-tertiary text-xs">
              {selectedDroneId ? (paused ? "Stream paused" : "Waiting for MAVLink frames...") : "Connect a drone to inspect MAVLink traffic"}
            </div>
          ) : (
            <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
              {virt.getVirtualItems().map((row) => {
                const msg = filtered[row.index];
                const isExpanded = expandedId === msg.id;
                const decoded = isExpanded ? decodePayload(msg.msgId, msg.frame.payload) : null;
                return (
                  <div
                    key={msg.id}
                    data-index={row.index}
                    ref={virt.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <div className={`flex items-start gap-0 px-4 py-0.5 hover:bg-bg-tertiary/50 cursor-pointer ${isExpanded ? "bg-bg-tertiary/30" : ""}`} onClick={() => setExpandedId(isExpanded ? null : msg.id)}>
                      <span className="w-[90px] shrink-0 text-text-tertiary">{formatTime(msg.frame.timestamp)}</span>
                      <span className="w-[20px] shrink-0 text-gcs-hud-green">RX</span>
                      <span className="w-[40px] shrink-0 text-right text-text-secondary">{msg.msgId}</span>
                      <span className="w-[180px] shrink-0 pl-2 text-accent-primary">{msg.msgName}</span>
                      <span className="w-[30px] shrink-0 text-right text-text-secondary">{msg.frame.systemId}</span>
                      <span className="w-[35px] shrink-0 text-right text-text-secondary">{msg.frame.componentId}</span>
                      <span className="w-[30px] shrink-0 text-right text-text-tertiary">{msg.frame.sequence}</span>
                      <span className="w-[30px] shrink-0 text-right text-text-tertiary">{msg.frame.payload.byteLength}</span>
                      <span className="pl-2 flex-1 text-text-tertiary break-all">{payloadHex(msg.frame.payload)}</span>
                    </div>
                    {isExpanded && decoded && (
                      <div className="px-4 py-1.5 bg-bg-tertiary/20 border-l-2 border-accent-primary ml-4">
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                          {decoded.map((f) => (<div key={f.name} className="contents"><span className="text-text-tertiary">{f.name}</span><span className="text-text-primary">{f.value}</span></div>))}
                        </div>
                      </div>
                    )}
                    {isExpanded && !decoded && (
                      <div className="px-4 py-1 bg-bg-tertiary/20 border-l-2 border-border-default ml-4 text-text-tertiary italic">No decoder available for {msg.msgName}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
