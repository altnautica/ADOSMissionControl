/**
 * @module MapContextMenu
 * @description Right-click context menu on the flight map. Context-aware menu
 * that shows different commands based on connection state, arm state, flight mode,
 * and vehicle capabilities. Supports navigation, camera/gimbal, home/origin,
 * rally points, POI markers, heading, and utility commands.
 *
 * Thin orchestrator: owns the menu shell, positioning, click-outside, keyboard
 * navigation, and renders. Per-action handlers live under `./context-menu/`.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useGuidedStore } from "@/stores/guided-store";
import { usePoiStore } from "@/stores/poi-store";
import { haversineDistance, bearing } from "@/lib/telemetry-utils";

import type { MenuPosition, MenuReport } from "./context-menu/types";
import { useMenuContext, useMenuItems } from "./context-menu/use-menu-items";
import { useMenuActions } from "./context-menu/use-menu-actions";
import { MenuItem } from "./context-menu/MenuItem";
import { OrbitPanel } from "./context-menu/panels/OrbitPanel";
import { SetHomeConfirmPanel } from "./context-menu/panels/SetHomeConfirmPanel";
import { PoiInputPanel } from "./context-menu/panels/PoiInputPanel";
import { handleOrbitConfirmed } from "./context-menu/actions/orbit";
import { handleSetHomeConfirmed } from "./context-menu/actions/home";
import { handleAddPoiConfirmed } from "./context-menu/actions/markers";

export function MapContextMenu() {
  const map = useMap();
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [orbitOpen, setOrbitOpen] = useState(false);
  const [orbitRadius, setOrbitRadius] = useState(50);
  const [orbitCw, setOrbitCw] = useState(true);
  const [poiInput, setPoiInput] = useState(false);
  const [poiLabel, setPoiLabel] = useState("");
  const [confirmHomeOpen, setConfirmHomeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const poiInputRef = useRef<HTMLInputElement>(null);

  // Prevent Leaflet from intercepting clicks inside the context menu.
  // React's stopPropagation does not work because Leaflet uses its own
  // event system (L.DomEvent) that runs in parallel with DOM events.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  });

  const ctx = useMenuContext();
  const menuItems = useMenuItems(ctx);

  const confirmPending = useGuidedStore((s) => s.confirmPending);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const addPoi = usePoiStore((s) => s.addMarker);

  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  // ── Close handlers ──────────────────────────────────────

  const closeMenu = useCallback(() => {
    setMenuPos(null);
    setHighlightIdx(-1);
    setOrbitOpen(false);
    setPoiInput(false);
    setPoiLabel("");
    setConfirmHomeOpen(false);
  }, []);

  useEffect(() => {
    if (confirmPending) closeMenu();
  }, [confirmPending, closeMenu]);

  // ── Right-click handler ─────────────────────────────────

  useEffect(() => {
    const onContextMenu = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      const containerPoint = map.latLngToContainerPoint(e.latlng);
      setMenuPos({
        x: containerPoint.x,
        y: containerPoint.y,
        lat: e.latlng.lat,
        lon: e.latlng.lng,
      });
      setHighlightIdx(-1);
      setOrbitOpen(false);
      setPoiInput(false);
      setConfirmHomeOpen(false);
    };

    map.on("contextmenu", onContextMenu);
    map.on("click", closeMenu);
    map.on("movestart", closeMenu);

    return () => {
      map.off("contextmenu", onContextMenu);
      map.off("click", closeMenu);
      map.off("movestart", closeMenu);
    };
  }, [map, closeMenu]);

  // ── Distance and bearing calculations ───────────────────

  const dist = useMemo(() => {
    if (!menuPos || !latestPos) return 0;
    return haversineDistance(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
  }, [menuPos, latestPos]);

  const bearingToDrone = useMemo(() => {
    if (!menuPos || !latestPos) return 0;
    return bearing(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
  }, [menuPos, latestPos]);

  const distLabel = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`;

  // ── Sub-panel openers passed to the action dispatcher ──

  const openOrbitPanel = useCallback(() => setOrbitOpen(true), []);
  const openHomeConfirmPanel = useCallback(() => setConfirmHomeOpen(true), []);
  const openPoiInputPanel = useCallback(() => {
    setPoiInput(true);
    setTimeout(() => poiInputRef.current?.focus(), 50);
  }, []);

  const { toast } = useToast();
  // Every flight-affecting menu action reports what the vehicle actually did.
  const report = useCallback<MenuReport>(
    (message, status) => toast(message, status),
    [toast],
  );

  const { dispatch } = useMenuActions({
    map,
    menuPos,
    latestPos,
    distLabel,
    bearingToDrone,
    openOrbitPanel,
    openHomeConfirmPanel,
    openPoiInputPanel,
    report,
  });

  const handleAction = useCallback(
    (id: string) => {
      const shouldClose = dispatch(id);
      if (shouldClose) closeMenu();
    },
    [dispatch, closeMenu],
  );

  // ── Sub-panel confirm handlers ──────────────────────────

  const handleOrbitConfirm = useCallback(() => {
    if (!menuPos) return;
    void handleOrbitConfirmed({
      protocol: getProtocol(),
      menuPos,
      radius: orbitRadius,
      clockwise: orbitCw,
      relativeAlt: latestPos?.relativeAlt,
      report,
    });
    closeMenu();
  }, [menuPos, getProtocol, orbitRadius, orbitCw, latestPos, closeMenu, report]);

  const handleHomeConfirm = useCallback(() => {
    if (!menuPos) return;
    void handleSetHomeConfirmed({ protocol: getProtocol(), menuPos, report });
    closeMenu();
  }, [menuPos, getProtocol, closeMenu, report]);

  const handlePoiConfirm = useCallback(() => {
    if (!menuPos) return;
    handleAddPoiConfirmed({ menuPos, label: poiLabel, addPoi });
    closeMenu();
  }, [menuPos, addPoi, poiLabel, closeMenu]);

  const handlePoiCancel = useCallback(() => {
    setPoiInput(false);
    setPoiLabel("");
  }, []);

  // ── Keyboard navigation ─────────────────────────────────

  useEffect(() => {
    if (!menuPos || orbitOpen || poiInput || confirmHomeOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((prev) => (prev + 1) % menuItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((prev) => (prev <= 0 ? menuItems.length - 1 : prev - 1));
        return;
      }
      if (e.key === "Enter" && highlightIdx >= 0) {
        e.preventDefault();
        handleAction(menuItems[highlightIdx].id);
        return;
      }

      // Shortcut keys
      const key = e.key.toUpperCase();
      const match = menuItems.find((item) => item.shortcut === key);
      if (match) {
        e.preventDefault();
        handleAction(match.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuPos, menuItems, highlightIdx, handleAction, closeMenu, orbitOpen, poiInput, confirmHomeOpen]);

  // ── Edge-aware positioning ──────────────────────────────

  const menuStyle = useMemo(() => {
    if (!menuPos) return {};
    const container = map.getContainer();
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const menuW = 220;
    const menuH = menuItems.length * 32 + 40; // rough estimate

    let left = menuPos.x;
    let top = menuPos.y;
    if (left + menuW > cw) left = cw - menuW - 8;
    if (top + menuH > ch) top = ch - menuH - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;

    return { left, top, minWidth: menuW };
  }, [menuPos, map, menuItems.length]);

  // ── Render ──────────────────────────────────────────────

  if (!menuPos) return null;

  // Group dividers
  const groups = new Set(menuItems.map((i) => i.group));
  const sortedGroups = Array.from(groups).sort((a, b) => a - b);

  return (
    <div
      ref={menuRef}
      className="absolute z-[2000] bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg shadow-lg overflow-hidden"
      style={menuStyle}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {orbitOpen && (
        <OrbitPanel
          radius={orbitRadius}
          setRadius={setOrbitRadius}
          clockwise={orbitCw}
          setClockwise={setOrbitCw}
          onConfirm={handleOrbitConfirm}
          onCancel={() => setOrbitOpen(false)}
        />
      )}

      {confirmHomeOpen && (
        <SetHomeConfirmPanel
          onConfirm={handleHomeConfirm}
          onCancel={() => setConfirmHomeOpen(false)}
        />
      )}

      {poiInput && (
        <PoiInputPanel
          ref={poiInputRef}
          label={poiLabel}
          setLabel={setPoiLabel}
          onConfirm={handlePoiConfirm}
          onCancel={handlePoiCancel}
        />
      )}

      {/* Menu items */}
      {!orbitOpen &&
        !confirmHomeOpen &&
        !poiInput &&
        sortedGroups.map((group, gi) => {
          const groupItems = menuItems.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group}>
              {gi > 0 && <div className="border-t border-border-default" />}
              {groupItems.map((item) => {
                const idx = menuItems.indexOf(item);
                return (
                  <MenuItem
                    key={item.id}
                    item={item}
                    highlighted={highlightIdx === idx}
                    onClick={() => handleAction(item.id)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  />
                );
              })}
            </div>
          );
        })}

      {/* Coordinate + distance footer */}
      <div className="border-t border-border-default" />
      <div className="px-3 py-1 text-[9px] font-mono text-text-tertiary flex justify-between items-center">
        <span>
          {menuPos.lat.toFixed(6)}, {menuPos.lon.toFixed(6)}
        </span>
        <span className="flex items-center gap-1.5">
          {dist > 0 && <span>{distLabel}</span>}
          {dist > 0 && bearingToDrone > 0 && <span>{Math.round(bearingToDrone)}°</span>}
        </span>
      </div>
    </div>
  );
}
