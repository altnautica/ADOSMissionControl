/**
 * @module CustomOsdElementsPanel
 * @description iNav custom OSD elements editor.
 * Shows up to the FC-reported element count of custom text OSD elements. Each
 * element has a visibility toggle and a free-text field (ASCII, length the FC
 * reports). Read loads every element back from the FC; Save writes one row
 * with the FC's own element geometry, so a row can never be rejected for a
 * size mismatch the firmware does not accept.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { PanelHeader } from "../shared/PanelHeader";
import { Type } from "lucide-react";
import type {
  INavCustomOsdElement,
  INavCustomOsdElementsInfo,
} from "@/lib/protocol/msp/msp-decoders-inav";

const MAX_TEXT_LEN = 16;

/** One editable row: an element with its visibility rule reduced to a toggle. */
interface OsdElement {
  index: number;
  visible: boolean;
  text: string;
}

function defaultElement(index: number): OsdElement {
  return { index, visible: false, text: "" };
}

/** The wire value one row becomes: parts untouched, visibility = always/toggle. */
function toWire(row: OsdElement): INavCustomOsdElement {
  return {
    index: row.index,
    parts: [],
    // Type 0 is "always visible"; any other type is a gated rule. A hidden
    // row is gated on global variable 0, which defaults to false.
    visibility: { type: row.visible ? 0 : 1, value: 0 },
    text: row.text,
  };
}

/** The visible toggle reads back as a visibility type-0 rule (always on). */
function fromWire(el: INavCustomOsdElement): OsdElement {
  return { index: el.index, visible: el.visibility.type === 0, text: el.text };
}

// ── Component ─────────────────────────────────────────────────

export function CustomOsdElementsPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [info, setInfo] = useState<INavCustomOsdElementsInfo | null>(null);
  const [elements, setElements] = useState<OsdElement[]>([]);

  const { isArmed, lockMessage } = useArmedLock();

  const handleReset = useCallback(() => {
    setElements([]);
    setInfo(null);
    setHasLoaded(false);
    setError(null);
  }, []);

  const handleRead = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getCustomOsdElements) { setError("Custom OSD elements not available on this firmware"); return; }
    setLoading(true); setError(null);
    try {
      const { info: fcInfo, elements: fcElements } = await protocol.getCustomOsdElements();
      setInfo(fcInfo);
      setElements(fcElements.map(fromWire));
      setHasLoaded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  function updateElement(idx: number, key: keyof OsdElement, value: unknown) {
    setElements((prev) =>
      prev.map((el, i) => (i === idx ? { ...el, [key]: value } : el)),
    );
  }

  const handleSave = useCallback(async (idx: number) => {
    const protocol = selectedProtocol;
    if (!protocol?.setCustomOsdElement) { setError("Custom OSD elements not available on this firmware"); return; }
    setSavingIdx(idx); setError(null);
    try {
      const result = await protocol.setCustomOsdElement(toWire(elements[idx]));
      if (!result.success) setError(result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingIdx(null);
    }
  }, [selectedProtocol, elements]);

  const textLength = info?.textLength ?? MAX_TEXT_LEN;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Custom OSD"
          subtitle={`${info?.maxElements ?? 0} custom text OSD elements, up to ${textLength} ASCII characters each.`}
          icon={<Type size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && (
            <button
              onClick={handleReset}
              className="text-[11px] px-3 py-1 border border-border-default text-text-secondary rounded hover:bg-bg-tertiary"
            >
              Reset
            </button>
          )}
        </PanelHeader>

        {hasLoaded && (
          <div className="border border-border-default rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border-default bg-bg-secondary">
                  <th className="px-3 py-2 text-left text-text-tertiary font-medium w-8">#</th>
                  <th className="px-3 py-2 text-left text-text-tertiary font-medium w-20">Visible</th>
                  <th className="px-3 py-2 text-left text-text-tertiary font-medium">Text</th>
                  <th className="px-3 py-2 text-left text-text-tertiary font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {elements.map((el, idx) => (
                  <tr key={idx} className="border-b border-border-default last:border-0">
                    <td className="px-3 py-2 font-mono text-text-tertiary">{idx}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => updateElement(idx, "visible", !el.visible)}
                        className={`px-2 py-0.5 rounded border text-[10px] ${
                          el.visible
                            ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                            : "border-border-default text-text-secondary"
                        }`}
                      >
                        {el.visible ? "On" : "Off"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        maxLength={textLength}
                        value={el.text}
                        onChange={(e) => updateElement(idx, "text", e.target.value.slice(0, textLength))}
                        placeholder={`Element ${idx} text`}
                        className="w-full bg-bg-tertiary border border-border-default rounded px-2 py-1 font-mono text-text-primary placeholder:text-text-tertiary"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleSave(idx)}
                        disabled={savingIdx === idx || isArmed}
                        title={isArmed ? lockMessage : undefined}
                        className="text-[10px] px-2 py-1 border border-accent-primary text-accent-primary rounded hover:bg-accent-primary/10 disabled:opacity-50"
                      >
                        {savingIdx === idx ? "..." : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}