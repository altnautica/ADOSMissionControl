/**
 * @module mock/capture-demo-panel
 * @description Mounts the demo rendition of the Capture surface
 * (`capture-monitor-demo`) in its own React root under the inline plugin
 * host, labelled as demo data. Loaded by `mock-extension-pages` on mount, so
 * it lands only in the chunk a demo session opens.
 *
 * @license GPL-3.0-only
 */

import { createRoot } from "react-dom/client";

import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { CaptureMonitorDemo } from "./capture-monitor-demo";

/** Render the demo Capture surface under the inline host's root; the
 * returned disposer unmounts it. */
export function mountCaptureDemoPanel(root: HTMLElement, host: InlineHostApi): () => void {
  const tr = (key: string, fallback: string): string => {
    const out = host.ctx.i18n.t(key);
    return out === key ? fallback : out;
  };
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.flex = "1 1 auto";
  root.append(container);
  const reactRoot = createRoot(container);
  reactRoot.render(<CaptureMonitorDemo tr={tr} />);
  return () =>
    queueMicrotask(() => {
      reactRoot.unmount();
      container.remove();
    });
}
