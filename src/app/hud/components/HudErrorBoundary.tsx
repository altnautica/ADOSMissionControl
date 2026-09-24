"use client";

/**
 * @module HudErrorBoundary
 * @description Class-based error boundary for the HDMI kiosk HUD. Catches
 * render-time errors in any HUD subtree and renders a dark fallback with a
 * reload button. Kiosk-grade: no navigation away, just recover in place.
 * @license GPL-3.0-only
 */

import { Component, type ReactNode } from "react";

interface HudErrorBoundaryProps {
  children: ReactNode;
}

interface HudErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

export class HudErrorBoundary extends Component<
  HudErrorBoundaryProps,
  HudErrorBoundaryState
> {
  constructor(props: HudErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: unknown): HudErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Keep this lightweight. The kiosk runs headless; console is the only sink.
    console.error("[HudErrorBoundary]", error, info);
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-media text-on-media font-mono flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 px-6 py-8 rounded border border-status-error/40 bg-status-error/40 max-w-md">
            <div className="text-sm uppercase tracking-wider text-status-error">
              HUD error
            </div>
            <div className="text-xs text-on-media/70 text-center break-words">
              {this.state.message ?? "Unknown error"}
            </div>
            <button
              onClick={this.handleReload}
              className="mt-2 px-4 py-1.5 text-xs uppercase tracking-wider bg-on-media/10 border border-on-media/30 text-on-media/90 hover:bg-on-media/20 transition-colors rounded"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
