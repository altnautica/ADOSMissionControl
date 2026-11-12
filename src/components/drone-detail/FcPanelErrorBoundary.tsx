"use client";

/**
 * Keeps a crashing FC panel inside the panel area: the Setup nav and every
 * other panel stay usable, and `onError` lets the tab stop remembering the
 * panel that threw so a reload does not land on it again. Mount it with
 * `key={activePanel}` so choosing another panel clears the error.
 * @license GPL-3.0-only
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  message: string;
  retryLabel: string;
  onError?: () => void;
}

export class FcPanelErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[FcPanelErrorBoundary]", error, info.componentStack);
    this.props.onError?.();
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-text-secondary">{this.props.message}</p>
        <button
          onClick={() => this.setState({ hasError: false })}
          className="px-3 py-1 text-xs font-medium text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10 transition-colors"
        >
          {this.props.retryLabel}
        </button>
      </div>
    );
  }
}
