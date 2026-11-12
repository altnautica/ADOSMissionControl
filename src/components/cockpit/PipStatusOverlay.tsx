"use client";

/**
 * @module cockpit/PipStatusOverlay
 * @description What a picture-in-picture inset shows while its stream is not
 * live: no signal with a Retry, or a spinner while connecting or
 * reconnecting, instead of a silent black rectangle (mirrors the main
 * VideoCanvas placeholder). Words come from the shared cockpit spec.
 *
 * @license GPL-3.0-only
 */

import { Loader2, RefreshCw } from "lucide-react";

import type { PipVideoStatus } from "@/hooks/use-pip-video";
import { specString } from "@/lib/cockpit/spec-strings";

export function PipStatusOverlay({ status, onRetry }: { status: PipVideoStatus; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg-primary/70">
      {status === "error" ? (
        <>
          <span className="text-[9px] font-mono uppercase tracking-wider text-status-error">
            {specString("cockpit.pip.no_signal")}
          </span>
          <button
            type="button"
            onClick={onRetry}
            aria-label={specString("video.state.retry")}
            className="flex min-h-12 min-w-12 items-center justify-center gap-1 border border-border-default px-3 text-[9px] font-mono text-text-secondary transition-colors hover:border-accent-primary hover:text-accent-primary"
          >
            <RefreshCw size={9} aria-hidden="true" />
            {specString("video.state.retry")}
          </button>
        </>
      ) : (
        <Loader2
          size={16}
          className="animate-spin text-text-tertiary"
          aria-label={status === "lost" ? specString("cockpit.pip.reconnecting") : specString("cockpit.pip.connecting")}
        />
      )}
      {status === "lost" && (
        <span className="text-[9px] font-mono uppercase tracking-wider text-status-warning">
          {specString("cockpit.pip.reconnecting")}
        </span>
      )}
    </div>
  );
}
