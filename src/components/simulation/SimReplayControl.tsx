/**
 * @module SimReplayControl
 * @description Compact control for loading a recorded flight log (.bin / .log /
 * .tlog / .ulg) whose actual flown path is overlaid on the planned mission by
 * {@link ActualPathEntity}. Shows the loaded log name + point count, a Clear
 * button, and a calm empty / error hint. Delegates parsing to the sim-replay
 * store — nothing is drawn until a log with real GPS positions loads.
 * @license GPL-3.0-only
 */

"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { FileUp, X } from "lucide-react";
import {
  useSimReplayStore,
  type SimReplayError,
  type SimReplayErrorCode,
} from "@/stores/sim-replay-store";

/** Map a store error code to its translation key under `simulate.replay.*`. */
const ERROR_KEY: Record<SimReplayErrorCode, string> = {
  unsupported: "errorUnsupported",
  truncated: "errorTruncated",
  "no-positions": "errorNoPositions",
  "parse-failed": "errorParseFailed",
};

/**
 * The operator-facing sentence for a typed replay error. Only `truncated`
 * carries a value into its message — the byte offset where the log ran out,
 * which is what tells the operator the flight was cut short rather than the
 * file being unreadable.
 */
function errorText(
  error: SimReplayError,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (error.code === "truncated") {
    return t("errorTruncated", { offset: error.offset });
  }
  return t(ERROR_KEY[error.code]);
}

export function SimReplayControl() {
  const t = useTranslations("simulate.replay");
  const track = useSimReplayStore((s) => s.track);
  const error = useSimReplayStore((s) => s.error);
  const loadFromFile = useSimReplayStore((s) => s.loadFromFile);
  const clear = useSimReplayStore((s) => s.clear);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFromFile(file);
    // Reset so re-selecting the same file fires onChange again.
    e.target.value = "";
  };

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">{t("label")}</span>
        {track && (
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            title={t("clear")}
          >
            <X size={12} />
            {t("clear")}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".bin,.log,.tlog,.ulg"
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 w-full px-2 py-1.5 rounded border border-border-default bg-bg-tertiary text-xs text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors cursor-pointer"
      >
        <FileUp size={13} />
        {t("chooseFile")}
      </button>

      {track ? (
        <p className="text-xs text-text-tertiary truncate" title={track.name}>
          {t("loaded", { name: track.name, count: track.positions.length })}
        </p>
      ) : error ? (
        <p className="text-xs text-status-warning">{errorText(error, t)}</p>
      ) : (
        <p className="text-xs text-text-tertiary">{t("emptyHint")}</p>
      )}
    </div>
  );
}
