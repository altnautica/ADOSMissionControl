"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "@/stores/settings-store";
import { useToast } from "@/components/ui/toast";
import { syncPopupTheme } from "./deck-utils";

interface DetachedDeckPortalProps {
  children: (opts: { detached: boolean; open: () => void; close: () => void }) => React.ReactNode;
  renderDetachedContent: () => React.ReactNode;
}

export function DetachedDeckPortal({ children, renderDetachedContent }: DetachedDeckPortalProps) {
  const [detached, setDetached] = useState(false);
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const { toast } = useToast();

  const open = useCallback(() => {
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      setDetached(true);
      return;
    }

    const popup = window.open(
      "",
      "telemetry-deck-detached",
      "width=760,height=460,resizable=yes,scrollbars=no",
    );
    if (!popup) {
      toast("Popup blocked. Allow popups for this site to detach the telemetry deck.", "warning");
      return;
    }

    popup.document.title = "Telemetry Deck";
    popup.document.body.innerHTML = "";
    popup.document.body.style.overflow = "hidden";

    const styleNodes = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"));
    for (const node of styleNodes) {
      popup.document.head.appendChild(node.cloneNode(true));
    }

    syncPopupTheme(popup);

    const container = popup.document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    popup.document.body.appendChild(container);

    popup.addEventListener("beforeunload", () => {
      setDetached(false);
      setPopupContainer(null);
      popupRef.current = null;
    });

    popupRef.current = popup;
    setPopupContainer(container);
    setDetached(true);
    popup.focus();
  }, [toast]);

  const close = useCallback(() => {
    setDetached(false);
    setPopupContainer(null);
    const popup = popupRef.current;
    if (popup && !popup.closed) popup.close();
    popupRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const popup = popupRef.current;
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
    };
  }, []);

  // Sync theme changes to popup
  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || popup.closed) return;
    syncPopupTheme(popup);
  }, [themeMode, accentColor]);

  return (
    <>
      {children({ detached, open, close })}
      {detached && popupContainer && createPortal(
        <div className="w-full h-full bg-bg-primary p-2">
          <div className="w-full h-full border border-border-default bg-bg-secondary p-2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border-default pb-1.5 mb-2">
              <span className="text-[11px] font-mono text-text-secondary">Telemetry Deck</span>
              <button
                type="button"
                onClick={close}
                className="px-2 py-1 text-[10px] rounded border border-border-default text-text-tertiary hover:text-text-primary"
              >
                Reattach
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {renderDetachedContent()}
            </div>
          </div>
        </div>,
        popupContainer,
      )}
    </>
  );
}
