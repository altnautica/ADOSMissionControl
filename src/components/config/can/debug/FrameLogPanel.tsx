"use client";

/**
 * @module FrameLogPanel
 * @description Live virtualized log of decoded DroneCAN frames. Reads from
 * the bus store ring buffer (cap 4096, enforced by the store). Renders a
 * filter row (node ID, kind, direction, errors-only), pause/resume/clear/
 * export controls, and a windowed list of rows. Click a row to expand and
 * see the full payload hex dump plus decoded JSON when the message is one
 * of our eight known DSDL types.
 *
 * Color coding follows the spec: services blue, broadcasts grey, anonymous
 * amber, errors red.
 *
 * @license GPL-3.0-only
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Pause,
  Play,
  Trash2,
  Download,
  AlertOctagon,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDroneCanBusStore,
  type DecodedFrame,
} from "@/stores/dronecan";
import { DATA_TYPE_IDS } from "@/lib/dronecan/signatures";

type Kind = DecodedFrame["decoded"]["kind"];
type Dir = DecodedFrame["dir"];

interface Filters {
  node: string;
  kind: "all" | Kind;
  dir: "all" | Dir;
  errorsOnly: boolean;
}

const INITIAL_FILTERS: Filters = {
  node: "",
  kind: "all",
  dir: "all",
  errorsOnly: false,
};

const ROW_HEIGHT = 26;

/** Reverse lookup of the 8 known DSDL data type IDs by kind. */
const KNOWN_LABELS: Record<Kind, Map<number, string>> = {
  message: new Map([[DATA_TYPE_IDS.NodeStatus, "NodeStatus"]]),
  service: new Map([
    [DATA_TYPE_IDS.GetNodeInfo, "GetNodeInfo"],
    [DATA_TYPE_IDS.paramGetSet, "param.GetSet"],
    [DATA_TYPE_IDS.paramExecuteOpcode, "param.ExecuteOpcode"],
    [DATA_TYPE_IDS.RestartNode, "RestartNode"],
    [DATA_TYPE_IDS.fileBeginFirmwareUpdate, "file.BeginFirmwareUpdate"],
    [DATA_TYPE_IDS.fileRead, "file.Read"],
    [DATA_TYPE_IDS.GetTransportStats, "GetTransportStats"],
  ]),
  anonymous: new Map(),
};

function dsdlLabel(frame: DecodedFrame): string {
  if (frame.label) return frame.label;
  const map = KNOWN_LABELS[frame.decoded.kind];
  const hit = map?.get(frame.decoded.dataTypeId);
  return hit ?? "raw";
}

function payloadOneLiner(payload: Uint8Array): string {
  const n = Math.min(payload.byteLength, 8);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(payload[i].toString(16).toUpperCase().padStart(2, "0"));
  }
  if (payload.byteLength > n) parts.push("…");
  return parts.join(" ");
}

function fullHexDump(payload: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < payload.byteLength; i += 16) {
    const row: string[] = [];
    for (let j = 0; j < 16 && i + j < payload.byteLength; j++) {
      row.push(payload[i + j].toString(16).toUpperCase().padStart(2, "0"));
    }
    lines.push(`${i.toString(16).padStart(4, "0").toUpperCase()}  ${row.join(" ")}`);
  }
  return lines.join("\n");
}

function dirArrow(d: Dir): string {
  return d === "in" ? "←" : "→";
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function applyFilters(
  frames: ReadonlyArray<DecodedFrame>,
  f: Filters,
): DecodedFrame[] {
  const nodeFilter = f.node.trim();
  const nodeNum = nodeFilter ? Number(nodeFilter) : null;
  return frames.filter((fr) => {
    if (f.errorsOnly && !fr.error) return false;
    if (f.kind !== "all" && fr.decoded.kind !== f.kind) return false;
    if (f.dir !== "all" && fr.dir !== f.dir) return false;
    if (nodeNum !== null && !Number.isNaN(nodeNum) && fr.decoded.srcNodeId !== nodeNum)
      return false;
    return true;
  });
}

export function FrameLogPanel() {
  const t = useTranslations("canConfig.debug.frameLog");
  const ringBuffer = useDroneCanBusStore((s) => s.frames);
  const paused = useDroneCanBusStore((s) => s.paused);
  const version = useDroneCanBusStore((s) => s._version);
  const pause = useDroneCanBusStore((s) => s.pause);
  const resume = useDroneCanBusStore((s) => s.resume);
  const clear = useDroneCanBusStore((s) => s.clear);

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [expanded, setExpanded] = useState<number | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const all = ringBuffer.toArray();
    // `applyFilters` already returns a fresh array, so the `.slice()` that
    // used to sit here was a second full copy of the CAN ring on every
    // version bump — i.e. per rAF at bus rate, with the ring holding
    // thousands of frames.
    return applyFilters(all, filters).reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringBuffer, filters, version]);

  const firstFrameT = visible.length > 0 ? visible[visible.length - 1].t : 0;

  const virt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const exportCsv = useCallback(() => {
    const rows: string[] = [
      [
        "t_ms",
        "dir",
        "kind",
        "can_id",
        "dsdl",
        "src",
        "dst",
        "payload_hex",
        "error",
      ].map(csvEscape).join(","),
    ];
    for (const fr of visible) {
      const tRel = firstFrameT ? fr.t - firstFrameT : 0;
      const payload = Array.from(fr.payload)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      rows.push(
        [
          String(tRel),
          fr.dir,
          fr.decoded.kind,
          `0x${fr.canId.toString(16).toUpperCase()}`,
          dsdlLabel(fr),
          String(fr.decoded.srcNodeId),
          fr.decoded.dstNodeId != null ? String(fr.decoded.dstNodeId) : "",
          payload,
          fr.error ? "1" : "0",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dronecan-frames-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [visible, firstFrameT]);

  // Reset expanded row whenever the list shape changes — keep the UI honest.
  useEffect(() => {
    setExpanded(null);
  }, [filters]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-default gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">
          {t("title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => (paused ? resume() : pause())}
            className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default rounded hover:bg-bg-tertiary text-text-secondary"
            data-testid="frame-log-pause-toggle"
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
            {paused ? t("resume") : t("pause")}
          </button>
          <button
            onClick={clear}
            className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default rounded hover:bg-bg-tertiary text-text-secondary"
          >
            <Trash2 size={10} />
            {t("clear")}
          </button>
          <button
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default rounded hover:bg-bg-tertiary text-text-secondary disabled:opacity-30"
          >
            <Download size={10} />
            {t("exportCsv")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-border-default">
        <input
          type="text"
          placeholder={t("filterByNode")}
          value={filters.node}
          onChange={(e) => setFilters((f) => ({ ...f, node: e.target.value }))}
          className="px-2 py-1 text-[11px] bg-bg-tertiary border border-border-default rounded w-24 text-text-primary"
          aria-label={t("filterByNode")}
        />
        <KindChips
          value={filters.kind}
          onChange={(k) => setFilters((f) => ({ ...f, kind: k }))}
          label={t("filterByKind")}
        />
        <DirChips
          value={filters.dir}
          onChange={(d) => setFilters((f) => ({ ...f, dir: d }))}
          label={t("filterByDirection")}
        />
        <label className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={filters.errorsOnly}
            onChange={(e) =>
              setFilters((f) => ({ ...f, errorsOnly: e.target.checked }))
            }
            className="accent-status-error"
          />
          <AlertOctagon size={10} />
          {t("errorsOnly")}
        </label>
      </div>

      <div className="grid grid-cols-[60px_24px_90px_140px_50px_1fr] gap-x-2 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-text-tertiary border-b border-border-default">
        <span>{t("column.time")}</span>
        <span>{t("column.dir")}</span>
        <span>{t("column.canId")}</span>
        <span>{t("column.dsdl")}</span>
        <span>{t("column.node")}</span>
        <span>{t("column.payload")}</span>
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
        data-testid="frame-log-scroll"
      >
        {visible.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-text-tertiary">
            {t("empty")}
          </div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((vi) => {
              const fr = visible[vi.index];
              const isOpen = expanded === vi.index;
              const tRel = firstFrameT ? fr.t - firstFrameT : 0;
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
                  data-frame-row="true"
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : vi.index)}
                    className={cn(
                      "grid grid-cols-[60px_24px_90px_140px_50px_1fr] gap-x-2 px-2 py-1 text-[11px] font-mono w-full text-left hover:bg-bg-tertiary border-b border-border-default",
                      fr.error && "text-status-error",
                      !fr.error && fr.decoded.kind === "service" && "text-accent-primary",
                      !fr.error && fr.decoded.kind === "anonymous" && "text-status-warning",
                      !fr.error && fr.decoded.kind === "message" && "text-text-secondary",
                    )}
                  >
                    <span className="text-text-tertiary">+{tRel}ms</span>
                    <span>{dirArrow(fr.dir)}</span>
                    <span>0x{fr.canId.toString(16).toUpperCase()}</span>
                    <span className="truncate flex items-center gap-1">
                      {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      {dsdlLabel(fr)}
                    </span>
                    <span>{fr.decoded.srcNodeId}</span>
                    <span className="truncate">{payloadOneLiner(fr.payload)}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2 bg-bg-primary border-b border-border-default text-[11px] font-mono whitespace-pre text-text-secondary">
                      {fullHexDump(fr.payload)}
                    </div>
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

function KindChips({
  value,
  onChange,
  label,
}: {
  value: Filters["kind"];
  onChange: (k: Filters["kind"]) => void;
  label: string;
}) {
  const opts: Filters["kind"][] = ["all", "message", "service", "anonymous"];
  return (
    <div className="flex items-center gap-1" aria-label={label}>
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] border",
            value === o
              ? "border-accent-primary text-accent-primary bg-accent-primary/10"
              : "border-border-default text-text-tertiary hover:bg-bg-tertiary",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function DirChips({
  value,
  onChange,
  label,
}: {
  value: Filters["dir"];
  onChange: (d: Filters["dir"]) => void;
  label: string;
}) {
  const opts: Filters["dir"][] = ["all", "in", "out"];
  return (
    <div className="flex items-center gap-1" aria-label={label}>
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] border",
            value === o
              ? "border-accent-primary text-accent-primary bg-accent-primary/10"
              : "border-border-default text-text-tertiary hover:bg-bg-tertiary",
          )}
        >
          {o === "in" ? "← in" : o === "out" ? "→ out" : o}
        </button>
      ))}
    </div>
  );
}
