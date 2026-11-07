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

/** Top safety band height (px). */
export const SAFETY_BAND_PX = 40;
/** Skill Bar clearance at the bottom of the safe region (px). */
export const SKILL_BAR_CLEARANCE_PX = 112;
export const SKILL_BAR_CLEARANCE_TV_PX = 140;

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

/** Height of the safe region: the container minus the band and Skill Bar clearance. */
export function safeRegionHeight(layout: CockpitLayoutSize): number {
  const clearance =
    layout.widthClass === "tv" ? SKILL_BAR_CLEARANCE_TV_PX : SKILL_BAR_CLEARANCE_PX;
  return Math.max(0, layout.height - SAFETY_BAND_PX - clearance);
}

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

/** Bottom offset of the Skill Bar container inside the cockpit (px). */
export const SKILL_BAR_BOTTOM_PX = 12;

/**
 * The measured distance from the cockpit's bottom edge to the Skill Bar's
 * top (px), or the default clearance until measured. The range panel sits
 * 12 px above it.
 */
export function useSkillBarClearance(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(Math.round(el.getBoundingClientRect().height));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setHeight(Math.round(box.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return height && height > 0 ? height + SKILL_BAR_BOTTOM_PX : SKILL_BAR_CLEARANCE_PX;
}
