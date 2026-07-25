"use client";

/**
 * @module SurfaceErrorBoundary
 * @description Wraps the body of the active node-detail surface so a render
 *   failure inside one surface does not unwind past the panel and blank the
 *   whole console. Without it the nearest boundary is the route-level one,
 *   which takes the fleet list and every other tab down with the surface that
 *   threw. The fallback states what happened without guessing why, and offers
 *   a retry; the error is logged for developer triage.
 *
 *   Mount it with `key={activeTabId}` so switching tabs clears a caught error
 *   instead of pinning the fallback over a healthy surface.
 * @license GPL-3.0-only
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface SurfaceErrorBoundaryProps {
  children: ReactNode;
  /** Translated sentence rendered in place of the surface that threw. */
  message: string;
  /** Translated label for the retry control. */
  retryLabel: string;
}

interface SurfaceErrorBoundaryState {
  hasError: boolean;
}

export class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SurfaceErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the failure for developer triage; the fallback UI handles users.
    console.error("[SurfaceErrorBoundary]", error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-text-secondary">{this.props.message}</p>
          <button
            onClick={this.handleReset}
            className="px-3 py-1 text-xs font-medium text-accent-primary border border-accent-primary/30 rounded hover:bg-accent-primary/10 transition-colors"
          >
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
