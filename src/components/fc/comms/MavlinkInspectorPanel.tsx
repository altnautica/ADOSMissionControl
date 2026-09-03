"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { Radio, Filter, Pause, Play, Download, Trash2, ArrowUpDown } from "lucide-react";
import { MSG_NAMES, decodePayload, type InspectorMessage, type MsgRate } from "./mavlink-inspector-data";

export function MavlinkInspectorPanel() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);

  const [messages, setMessages] = useState<InspectorMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [filterMsgId, setFilterMsgId] = useState<string>("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [maxMessages] = useState(500);
  const [msgRates, setMsgRates] = useState<Map<number, MsgRate>>(new Map());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const msgCounterRef = useRef(0);
  const pausedRef = useRef(false);
  const ratesRef = useRef<Map<number, MsgRate>>(new Map());

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const drone = getSelectedDrone();
    if (!drone) return;

    const handler = (data: Uint8Array) => {
      let offset = 0;
      while (offset < data.length) {
        if (data[offset] !== 0xFD) { offset++; continue; }
        if (offset + 10 > data.length) break;
        const payloadLen = data[offset + 1];
        const frameLen = 12 + payloadLen;
        if (offset + frameLen > data.length) break;

        const seq = data[offset + 4];
        const sysId = data[offset + 5];
        const compId = data[offset + 6];
        const msgId = data[offset + 7] | (data[offset + 8] << 8) | (data[offset + 9] << 16);
        const payloadBytes = data.slice(offset + 10, offset + 10 + payloadLen);
        const payloadHex = Array.from(payloadBytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const now = Date.now();

        const rate = ratesRef.current.get(msgId) ?? { count: 0, lastTime: now, hz: 0 };
        rate.count++;
        const elapsed = (now - rate.lastTime) / 1000;
        if (elapsed >= 1) { rate.hz = Math.round(rate.count / elapsed); rate.count = 0; rate.lastTime = now; }
        ratesRef.current.set(msgId, rate);

        if (!pausedRef.current) {
          const msg: InspectorMessage = {
            id: msgCounterRef.current++, timestamp: now, msgId, msgName: MSG_NAMES[msgId] ?? `MSG_${msgId}`,
            systemId: sysId, componentId: compId, sequence: seq, payloadLength: payloadLen,
            payloadHex, payloadBytes: new Uint8Array(payloadBytes), direction: "rx",
          };
          setMessages((prev) => {
            const next = [...prev, msg];
            return next.length > maxMessages ? next.slice(-maxMessages) : next;
          });
        }
        offset += frameLen;
      }
    };

    drone.transport.on("data", handler);
    return () => { drone.transport.off("data", handler); };
  }, [selectedDroneId, getSelectedDrone, maxMessages]);

  useEffect(() => {
    const interval = setInterval(() => { setMsgRates(new Map(ratesRef.current)); }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoscroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, autoscroll]);

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

  const filtered = filterIds ? messages.filter((m) => filterIds.has(m.msgId)) : messages;

  const exportLog = useCallback(() => {
    const lines = filtered.map((m) => {
      const time = new Date(m.timestamp).toISOString();
      return `[${time}] ${m.direction.toUpperCase()} ${m.msgName}(${m.msgId}) sys=${m.systemId} comp=${m.componentId} seq=${m.sequence} [${m.payloadHex}]`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mavlink-log-${Date.now()}.txt`;
    a.click();
    // Defer the revoke past download initiation. Revoking synchronously after
    // click() can cancel the download before the browser starts the stream.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [filtered]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  };

  const sortedRates = useMemo(() => {
    return Array.from(msgRates.entries())
      .map(([id, rate]) => ({ id, name: MSG_NAMES[id] ?? `MSG_${id}`, hz: rate.hz }))
      .sort((a, b) => b.hz - a.hz);
  }, [msgRates]);

  return (
    <div className="h-full flex">
      {/* Sidebar — Message rates */}
      <div className="w-[220px] border-r border-border-default bg-bg-secondary flex-shrink-0 flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border-default">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5"><ArrowUpDown size={12} />Message Rates</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sortedRates.length === 0 ? (
            <p className="p-3 text-[10px] text-text-tertiary italic">{selectedDroneId ? "Waiting for data..." : "Connect a drone"}</p>
          ) : (
            <table className="w-full text-[10px] font-mono">
              <thead><tr className="border-b border-border-default"><th className="text-left px-3 py-1 text-text-tertiary font-normal">Message</th><th className="text-right px-3 py-1 text-text-tertiary font-normal">Hz</th></tr></thead>
              <tbody>
                {sortedRates.map(({ id, name, hz }) => (
                  <tr key={id} className="hover:bg-bg-tertiary cursor-pointer" onClick={() => setFilterMsgId(String(id))}>
                    <td className="px-3 py-0.5 text-text-secondary">{name}</td>
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
          <button onClick={() => { setMessages([]); msgCounterRef.current = 0; }} className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"><Trash2 size={10} />Clear</button>
        </div>

        <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[10px] leading-4" onMouseEnter={() => setAutoscroll(false)} onMouseLeave={() => setAutoscroll(true)}>
          <div className="flex items-center gap-0 px-4 py-1 border-b border-border-default bg-bg-tertiary text-text-tertiary sticky top-0">
            <span className="w-[90px] shrink-0">Time</span><span className="w-[20px] shrink-0">Dir</span><span className="w-[40px] shrink-0 text-right">ID</span>
            <span className="w-[180px] shrink-0 pl-2">Name</span><span className="w-[30px] shrink-0 text-right">Sys</span><span className="w-[35px] shrink-0 text-right">Comp</span>
            <span className="w-[30px] shrink-0 text-right">Seq</span><span className="w-[30px] shrink-0 text-right">Len</span><span className="pl-2 flex-1">Payload</span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-tertiary text-xs">
              {selectedDroneId ? (paused ? "Stream paused" : "Waiting for MAVLink frames...") : "Connect a drone to inspect MAVLink traffic"}
            </div>
          ) : (
            filtered.map((msg) => {
              const isExpanded = expandedId === msg.id;
              const decoded = isExpanded ? decodePayload(msg.msgId, msg.payloadBytes) : null;
              return (
                <div key={msg.id}>
                  <div className={`flex items-start gap-0 px-4 py-0.5 hover:bg-bg-tertiary/50 cursor-pointer ${isExpanded ? "bg-bg-tertiary/30" : ""}`} onClick={() => setExpandedId(isExpanded ? null : msg.id)}>
                    <span className="w-[90px] shrink-0 text-text-tertiary">{formatTime(msg.timestamp)}</span>
                    <span className={`w-[20px] shrink-0 ${msg.direction === "tx" ? "text-accent-primary" : "text-gcs-hud-green"}`}>{msg.direction === "tx" ? "TX" : "RX"}</span>
                    <span className="w-[40px] shrink-0 text-right text-text-secondary">{msg.msgId}</span>
                    <span className="w-[180px] shrink-0 pl-2 text-accent-primary">{msg.msgName}</span>
                    <span className="w-[30px] shrink-0 text-right text-text-secondary">{msg.systemId}</span>
                    <span className="w-[35px] shrink-0 text-right text-text-secondary">{msg.componentId}</span>
                    <span className="w-[30px] shrink-0 text-right text-text-tertiary">{msg.sequence}</span>
                    <span className="w-[30px] shrink-0 text-right text-text-tertiary">{msg.payloadLength}</span>
                    <span className="pl-2 flex-1 text-text-tertiary break-all">{msg.payloadHex}</span>
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
