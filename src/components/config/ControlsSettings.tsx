"use client";

/**
 * @module config/ControlsSettings
 * @description Settings › Controls: the controller drawing (the shared
 * cockpit spec's `ds4-art.json`, or the generic pad for any other standard
 * pad) with leader-line labels naming each control's action, live input
 * (pressed controls fill, stick dots move inside their rings with the
 * deadzone ring, trigger bars), and editing: pick a control (click it, or
 * "Press a control" and press it), choose an action per gesture, move a
 * locked safety binding, resolve conflicts before Save. Also the stick mode,
 * stick calibration with the deadzone, the rumble / lightbar test row,
 * reset, export and import, and "Replay controller tour".
 *
 * It reads the same input store the stick stream reads: no second poller.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Lock } from "lucide-react";

import tokens from "@/lib/cockpit-spec/tokens.json";
import ds4Art from "@/lib/cockpit-spec/ds4-art.json";
import ds4Hotspots from "@/lib/cockpit-spec/ds4-hotspots.json";
import genericArt from "@/lib/cockpit-spec/gamepad-generic-art.json";
import genericHotspots from "@/lib/cockpit-spec/gamepad-generic-hotspots.json";
import { specString } from "@/lib/cockpit/spec-strings";
import {
  DS4_ACTIONS,
  DS4_CONTROLS,
  WEB_BUTTON_INDEX,
  actionLabel,
  bindingConflicts,
  type Ds4Binding,
  type Ds4Gesture,
} from "@/lib/input/ds4-bindings";
import { acquireGamepadPolling } from "@/lib/input/gamepad-poller";
import { shortPadName, usePadStatusStore } from "@/lib/input/pad-status";
import { useSkillRegistry } from "@/lib/skills";
import { cn } from "@/lib/utils";
import {
  bindingsSaveError,
  effectiveBindings,
  exportControls,
  importControls,
  useControlsStore,
} from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";
import { CalibrationCard, ClashedSkills, PrefsRow, ReplayTourRow, TestRow } from "./ControlsSettingsCards";
import { layoutLeaderLabels } from "./leader-labels";

type Art = { viewBox: number[]; stroke_width: number; paths: { id: string; d: string; role: string }[] };
type Hotspot = {
  shape: "circle" | "rect" | "path";
  geom: { cx?: number; cy?: number; r?: number; x?: number; y?: number; w?: number; h?: number; rx?: number; d?: string };
  label_anchor: [number, number];
  label_side: "left" | "right" | "top" | "bottom";
};

const GESTURES: readonly Exclude<Ds4Gesture, "analog">[] = ["press", "tap", "hold", "double_tap"];
const GROUP_LABEL: Record<string, string> = {
  flight: "Flight",
  skills: "Skills",
  camera: "Camera",
  view: "View & layers",
  profile: "Profile",
  none: "None",
};
/** The drawing's colours, from the cockpit spec's controller tokens. */
const PRESSED = tokens.controller.pressed;
const CONFLICT = tokens.controller.conflict;
const DEADZONE_RING = tokens.controller.deadzone_ring;
const SELECTED = tokens.state.skill;
/** Leader labels: line pitch, gap from the artwork, and gutter width (art units). */
const LABEL_PITCH = 36;
const LABEL_GAP = 28;
const LABEL_GUTTER = 280;

/** The short label for a control: its first binding without held controls. */
function controlLabel(bindings: readonly Ds4Binding[], control: string): string | null {
  const row = bindings.find((b) => b.control === control && b.with.length === 0 && b.action !== "none");
  return row ? actionLabel(row.action) : null;
}

function HotspotShape({
  h,
  className,
  style,
  onClick,
}: {
  h: Hotspot;
  className: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const g = h.geom;
  if (h.shape === "circle") return <circle cx={g.cx} cy={g.cy} r={g.r} className={className} style={style} onClick={onClick} />;
  if (h.shape === "rect")
    return <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={g.rx} className={className} style={style} onClick={onClick} />;
  return <path d={g.d} className={className} style={style} onClick={onClick} />;
}

function ControllerDrawing({
  generic,
  bindings,
  conflicts,
  selected,
  onSelect,
}: {
  generic: boolean;
  bindings: readonly Ds4Binding[];
  conflicts: Set<string>;
  selected: string | null;
  onSelect: (control: string) => void;
}) {
  const art = (generic ? genericArt : ds4Art) as unknown as Art;
  const hotspots = (generic ? genericHotspots : ds4Hotspots).hotspots as unknown as Record<string, Hotspot>;
  const buttons = useInputStore((s) => s.buttons);
  const padAxes = useInputStore((s) => s.padAxes);
  const deadzone = useInputStore((s) => s.deadzone);
  const pressed = (c: string) => buttons[WEB_BUTTON_INDEX[c] ?? -1] === true;
  const [vbX, vbY, vbW, vbH] = art.viewBox;
  const leaders = useMemo(
    () =>
      layoutLeaderLabels(
        Object.entries(hotspots).map(([id, h]) => ({ id, anchor: h.label_anchor, side: h.label_side })),
        { art: [vbX, vbY, vbW, vbH], pitch: LABEL_PITCH, gap: LABEL_GAP, gutter: LABEL_GUTTER },
      ),
    [hotspots, vbX, vbY, vbW, vbH],
  );
  const leaderById = new Map(leaders.labels.map((l) => [l.id, l]));
  const stick = (id: "stick_l" | "stick_r", ax: number, ay: number) => {
    const h = hotspots[id];
    if (!h || h.shape !== "circle") return null;
    const { cx = 0, cy = 0, r = 40 } = h.geom;
    return (
      <g key={`${id}-live`} pointerEvents="none">
        <circle cx={cx} cy={cy} r={r * deadzone * 2.5} fill="none" stroke={DEADZONE_RING} strokeDasharray="3 3" />
        <circle cx={cx + (padAxes[ax] ?? 0) * r} cy={cy + (padAxes[ay] ?? 0) * r} r={7} fill={PRESSED} data-testid={`${id}-dot`} />
      </g>
    );
  };
  return (
    <svg
      viewBox={leaders.viewBox.join(" ")}
      className="w-full max-w-[1040px] text-text-primary"
      data-testid="controller-drawing"
      role="img"
      aria-label="Controller"
    >
      {art.paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          data-control={p.role === "control" ? p.id : undefined}
          data-pressed={p.role === "control" && pressed(p.id) ? "true" : undefined}
          fill={p.role === "control" && pressed(p.id) ? PRESSED : "none"}
          stroke="currentColor"
          strokeWidth={art.stroke_width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={p.role === "detail" ? 0.55 : 1}
        />
      ))}
      {(["l2", "r2"] as const).map((t) => {
        const h = hotspots[t];
        if (!h || h.shape !== "rect") return null;
        return (
          <rect key={`${t}-bar`} x={h.geom.x} y={h.geom.y} width={(h.geom.w ?? 0) * (pressed(t) ? 1 : 0)} height={h.geom.h} rx={h.geom.rx} fill={PRESSED} opacity={0.6} pointerEvents="none" />
        );
      })}
      {stick("stick_l", 0, 1)}
      {stick("stick_r", 2, 3)}
      {Object.entries(hotspots).map(([id, h]) => {
        const label = id === "stick_l" || id === "stick_r" ? (id === "stick_l" ? "Throttle / Yaw" : "Pitch / Roll") : controlLabel(bindings, id);
        const leader = leaderById.get(id);
        if (!leader) return null;
        const [ax, ay] = leader.anchor;
        const elbowX = leader.side === "left" ? leader.x + LABEL_GAP / 2 : leader.x - LABEL_GAP / 2;
        const locked = bindings.some((b) => b.control === id && b.locked);
        return (
          <g key={id} data-hotspot={id} data-conflict={conflicts.has(id) ? "true" : undefined} data-selected={selected === id ? "true" : undefined}>
            <HotspotShape
              h={h}
              onClick={() => onSelect(id)}
              className={cn(
                "cursor-pointer fill-transparent",
                conflicts.has(id) ? "[stroke-width:5]" : selected === id ? "[stroke-width:4]" : "stroke-transparent hover:stroke-white/40",
              )}
              style={conflicts.has(id) ? { stroke: CONFLICT } : selected === id ? { stroke: SELECTED } : undefined}
            />
            {label && (
              <>
                <polyline
                  points={`${ax},${ay} ${elbowX},${leader.y} ${leader.x + (leader.side === "left" ? -2 : 2)},${leader.y}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
                <text
                  x={leader.x + (leader.side === "left" ? -6 : 6)}
                  y={leader.y + 7}
                  textAnchor={leader.side === "left" ? "end" : "start"}
                  data-label-side={leader.side}
                  className={cn("text-[22px]", !conflicts.has(id) && "fill-current")}
                  style={conflicts.has(id) ? { fill: CONFLICT } : undefined}
                  onClick={() => onSelect(id)}
                >
                  {locked ? "🔒 " : ""}
                  {label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ActionPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const registry = useSkillRegistry((s) => s.skills);
  const skills = useMemo(() => [...registry.values()].filter((s) => s.source === "plugin"), [registry]);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-12 w-full rounded border border-border-default bg-bg-secondary px-2 text-xs"
      aria-label="Action"
    >
      {Object.keys(GROUP_LABEL).map((g) =>
        g === "none" ? (
          <option key="none" value="none">
            None
          </option>
        ) : g === "skills" ? (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {skills.map((s) => (
              <option key={s.id} value={`skill:${s.id}`}>
                {s.id}
              </option>
            ))}
          </optgroup>
        ) : (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {DS4_ACTIONS.filter((a) => a.group === g).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  );
}

function ControlSheet({
  control,
  draft,
  setDraft,
  onClose,
}: {
  control: string;
  draft: readonly Ds4Binding[];
  setDraft: (next: Ds4Binding[]) => void;
  onClose: () => void;
}) {
  const rows = draft.map((b, i) => ({ b, i })).filter(({ b }) => b.control === control);
  const setRow = (i: number, patch: Partial<Ds4Binding>) => setDraft(draft.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setGesture = (gesture: Exclude<Ds4Gesture, "analog">, action: string) => {
    if (action === "none") {
      setDraft(draft.filter((b) => !(b.control === control && b.gesture === gesture && b.with.length === 0 && !b.locked)));
      return;
    }
    setDraft([
      ...draft,
      { control, with: [], gesture, hold_ms: gesture === "hold" ? 1500 : null, when: null, action, rumble: null, locked: false },
    ]);
  };
  return (
    <aside role="dialog" aria-label={`Control ${control}`} data-testid="control-sheet" className="glass-panel w-full max-w-sm p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{control}</h3>
        <button type="button" onClick={onClose} className="min-h-12 min-w-12 rounded px-2 text-xs hover:bg-white/10">
          Close
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map(({ b, i }) => (
          <div key={i} className="flex flex-col gap-1" data-testid={`binding-row-${b.action}`}>
            <span className="flex items-center gap-1 text-[11px] text-text-secondary">
              {b.locked && <Lock size={11} aria-label={specString("controls.locked")} />}
              {b.with.length > 0 ? `${b.with.join(" + ")} + ` : ""}
              {specString(`controls.gesture.${b.gesture}`)}
              {b.when ? ` · ${b.when.replace(/_/g, " ")}` : ""}
            </span>
            {b.locked ? (
              <label className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate">{actionLabel(b.action)}</span>
                <select
                  value={b.control}
                  onChange={(e) => setRow(i, { control: e.target.value })}
                  className="min-h-12 flex-1 rounded border border-border-default bg-bg-secondary px-2"
                  aria-label="Move to control"
                  title={specString("controls.locked")}
                >
                  {DS4_CONTROLS.filter((c) => !c.startsWith("stick") && c !== "lightbar").map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <ActionPicker
                value={b.action}
                onChange={(v) => (v === "none" ? setDraft(draft.filter((_, j) => j !== i)) : setRow(i, { action: v }))}
                disabled={b.gesture === "analog"}
              />
            )}
          </div>
        ))}
        {GESTURES.filter((g) => !rows.some(({ b }) => b.gesture === g && b.with.length === 0)).map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <span className="text-[11px] text-text-secondary">{specString(`controls.gesture.${g}`)}</span>
            <ActionPicker value="none" onChange={(v) => setGesture(g, v)} />
          </div>
        ))}
      </div>
    </aside>
  );
}

export function ControlsSettings() {
  const saved = useControlsStore((s) => s.bindings);
  const setBindings = useControlsStore((s) => s.setBindings);
  const resetBindings = useControlsStore((s) => s.reset);
  const pad = usePadStatusStore();
  const gamepadId = useInputStore((s) => s.gamepadId);
  const txMode = useInputStore((s) => s.txMode);
  const setTxMode = useInputStore((s) => s.setTxMode);
  // Unsaved edits; until the first edit the draft is the stored table, so a
  // store that hydrates after the first render still shows the saved bindings.
  const [edits, setDraft] = useState<Ds4Binding[] | null>(null);
  const draft = useMemo<readonly Ds4Binding[]>(() => edits ?? effectiveBindings({ bindings: saved }), [edits, saved]);
  const [selected, setSelected] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const generic = !!gamepadId && !/054c|wireless controller|dualshock|ps4/i.test(gamepadId);
  useEffect(() => acquireGamepadPolling(), []);

  // "Press a control": the next physical press selects that control.
  useEffect(() => {
    if (!capture) return;
    const before = useInputStore.getState().buttons.slice();
    return useInputStore.subscribe((s) => {
      const idx = s.buttons.findIndex((b, i) => b && !before[i]);
      if (idx < 0) return;
      const control = Object.entries(WEB_BUTTON_INDEX).find(([, v]) => v === idx)?.[0];
      if (control) {
        setSelected(control);
        setCapture(false);
      }
    });
  }, [capture]);

  const conflictIdx = bindingConflicts(draft);
  const conflictControls = new Set([...conflictIdx].map((i) => draft[i].control));
  const saveError = bindingsSaveError(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(effectiveBindings({ bindings: saved }));

  const save = () => {
    if (saveError) return;
    setBindings([...draft]);
    setDraft(null);
    setMessage("Saved");
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(exportControls(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ados-controls.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (file: File) => {
    const err = importControls(await file.text());
    setMessage(err ?? "Imported");
    if (!err) setDraft([...effectiveBindings()]);
  };

  return (
    <section className="flex flex-col gap-4" data-testid="controls-settings">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{specString("controls.title")}</h2>
        <span className="text-xs text-text-secondary" data-testid="controls-pad-name">
          {pad.connected ? (shortPadName(pad.name) ?? "Controller") : specString("controls.press_any_button")}
        </span>
        {pad.needsCalibration && <span className="text-xs text-status-warning">{specString("controls.not_standard")}</span>}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Stick mode">
          {([1, 2] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={txMode === m}
              onClick={() => setTxMode(m)}
              className={cn("min-h-12 rounded px-2 text-xs", txMode === m ? "bg-accent-primary/25 text-accent-primary" : "bg-white/5")}
            >
              {specString(`controls.mode${m}`)}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-secondary">
          {specString(saved ? "controls.profile.user" : "controls.profile.ados_default")}
        </span>
      </header>

      <ClashedSkills />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex-1">
          <ControllerDrawing generic={generic} bindings={draft} conflicts={conflictControls} selected={selected} onSelect={setSelected} />
        </div>
        {selected && <ControlSheet control={selected} draft={draft} setDraft={setDraft} onClose={() => setSelected(null)} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCapture((c) => !c)}
          aria-pressed={capture}
          className="min-h-12 rounded border px-3 text-xs"
        >
          {specString("controls.press_a_control")}
        </button>
        <button type="button" onClick={save} disabled={!!saveError || !dirty} data-testid="controls-save" className="min-h-12 rounded bg-accent-primary px-3 text-xs font-semibold text-white disabled:opacity-40">
          {specString("controls.save")}
        </button>
        <button
          type="button"
          onClick={() => {
            resetBindings();
            setDraft([...effectiveBindings({ bindings: null })]);
          }}
          className="min-h-12 rounded border px-3 text-xs"
        >
          {specString("controls.reset")}
        </button>
        <button type="button" onClick={download} className="min-h-12 rounded border px-3 text-xs">
          {specString("controls.export")}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 rounded border px-3 text-xs">
          {specString("controls.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {saveError && <span role="alert" data-testid="controls-save-error" className="text-xs text-status-error">{saveError}</span>}
        {message && !saveError && <span className="text-xs text-text-secondary">{message}</span>}
      </div>

      <CalibrationCard />
      <TestRow />
      <PrefsRow />
      <ReplayTourRow />
    </section>
  );
}
