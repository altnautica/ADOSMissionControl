/**
 * @module map/context-menu/panels/RallyAltitudePanel
 * @description Rally point sub-panel inside the right-click menu. The operator
 * confirms the loiter altitude (defaulted from the vehicle's return altitude)
 * before the point is added and the rally set is uploaded.
 * @license GPL-3.0-only
 */

"use client";

interface RallyAltitudePanelProps {
  /** Altitude field text, metres relative to home. */
  alt: string;
  setAlt: (alt: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RallyAltitudePanel({ alt, setAlt, onConfirm, onCancel }: RallyAltitudePanelProps) {
  const valid = Number(alt) > 0;
  return (
    <div className="px-3 py-2 border-b border-border-default">
      <div className="text-[10px] font-mono text-text-secondary mb-1.5">Rally Point</div>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[9px] text-text-tertiary w-12">Altitude</label>
        <input
          type="number"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          min={1}
          step={5}
          placeholder="Return alt"
          className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none"
        />
        <span className="text-[9px] text-text-tertiary">m rel</span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={onConfirm}
          disabled={!valid}
          className="flex-1 px-2 py-1 text-[10px] font-mono font-semibold bg-accent-primary/20 border border-accent-primary/40 text-accent-primary rounded hover:bg-accent-primary/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add &amp; Upload
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[10px] font-mono text-text-tertiary border border-border-default rounded hover:text-text-primary cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
