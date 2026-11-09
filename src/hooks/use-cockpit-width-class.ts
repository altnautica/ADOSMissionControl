"use client";

/**
 * @module use-cockpit-width-class
 * @description The cockpit's width class (`lib/cockpit/width-class`) from the
 * cockpit CONTAINER width. The cockpit root measures itself with a
 * ResizeObserver and publishes the class plus its size through
 * {@link CockpitLayoutContext}; every chrome element reads it from there.
 *
 * @license GPL-3.0-only
 */

import { type RefObject, createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { isKioskSearch, widthClassFor, type CockpitWidthClass } from "@/lib/cockpit/width-class";

export interface CockpitLayoutSize {
  widthClass: CockpitWidthClass;
  width: number;
  height: number;
}

export const DEFAULT_COCKPIT_LAYOUT: CockpitLayoutSize = {
  widthClass: "expanded",
  width: 1280,
  height: 720,
};

function readKiosk(): boolean {
  return typeof window !== "undefined" && isKioskSearch(window.location.search);
}

function noSubscribe(): () => void {
  return () => {};
}

export const CockpitLayoutContext = createContext<CockpitLayoutSize>(DEFAULT_COCKPIT_LAYOUT);

/** The cockpit layout size published by the cockpit root. */
export function useCockpitLayoutSize(): CockpitLayoutSize {
  return useContext(CockpitLayoutContext);
}

/** The cockpit width class published by the cockpit root. */
export function useCockpitWidthClass(): CockpitWidthClass {
  return useContext(CockpitLayoutContext).widthClass;
}

/**
 * Measure a container element and derive its layout size. Used once, by the
 * cockpit root, which provides the result through {@link CockpitLayoutContext}.
 */
export function useCockpitContainerLayout(
  ref: RefObject<HTMLElement | null>,
): CockpitLayoutSize {
  const kiosk = useSyncExternalStore(noSubscribe, readKiosk, () => false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (width: number, height: number) =>
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    const rect = el.getBoundingClientRect();
    measure(Math.round(rect.width), Math.round(rect.height));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) measure(Math.round(box.width), Math.round(box.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const width = size && size.width > 0 ? size.width : DEFAULT_COCKPIT_LAYOUT.width;
  const height = size && size.height > 0 ? size.height : DEFAULT_COCKPIT_LAYOUT.height;
  // A stable object: it is the context value, so a new one per cockpit render
  // would re-render every consumer (the layer stack among them) at telemetry rate.
  const widthClass = widthClassFor(width, kiosk);
  return useMemo(() => ({ widthClass, width, height }), [widthClass, width, height]);
}
