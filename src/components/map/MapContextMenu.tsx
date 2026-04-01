/**
 * @module MapContextMenu
 * @description Right-click context menu on the flight map. Context-aware menu
 * that shows different commands based on connection state, arm state, flight mode,
 * and vehicle capabilities. Supports navigation, camera/gimbal, home/origin,
 * rally points, POI markers, heading, and utility commands.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useGuidedStore } from "@/stores/guided-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePoiStore } from "@/stores/poi-store";
import { haversineDistance, bearing } from "@/lib/telemetry-utils";

// ── Types ───────────────────────────────────────────────────

interface MenuPosition {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

interface MenuItemDef {
  id: string;
  label: string;
  icon: string;
  group: number;
  shortcut?: string;
  danger?: boolean;
}

// ── Constants ───────────────────────────────────────────────

const GUIDED_MODES = new Set(["GUIDED", "AUTO", "GUIDED_NOGPS", "LOITER"]);

// SVG icon paths (14x14 viewbox)
const ICONS: Record<string, string> = {
  flyHere: '<polygon points="7,1 13,13 7,9 1,13" fill="#3A82FF" fill-opacity="0.6" stroke="#3A82FF" stroke-width="1"/>',
  flyHereAlt: '<polygon points="7,3 11,11 7,8 3,11" fill="none" stroke="#3A82FF" stroke-width="1.2"/><line x1="12" y1="2" x2="12" y2="6" stroke="#3A82FF" stroke-width="1.2"/>',
  orbit: '<circle cx="7" cy="7" r="5" fill="none" stroke="#3A82FF" stroke-width="1.2" stroke-dasharray="3 2"/><circle cx="7" cy="2" r="1.5" fill="#3A82FF"/>',
  loiter: '<circle cx="7" cy="7" r="5" fill="none" stroke="#f59e0b" stroke-width="1.2"/><circle cx="7" cy="7" r="1.5" fill="#f59e0b"/>',
  land: '<path d="M3,11 L11,11 M7,3 L7,9 M4,7 L7,10 L10,7" fill="none" stroke="#22c55e" stroke-width="1.2"/>',
  camera: '<rect x="2" y="4" width="10" height="7" rx="1" fill="none" stroke="#a78bfa" stroke-width="1.2"/><circle cx="7" cy="7.5" r="2" fill="none" stroke="#a78bfa" stroke-width="1"/>',
  roi: '<circle cx="7" cy="7" r="3" fill="none" stroke="#a78bfa" stroke-width="1.2"/><line x1="7" y1="1" x2="7" y2="4" stroke="#a78bfa" stroke-width="1"/><line x1="7" y1="10" x2="7" y2="13" stroke="#a78bfa" stroke-width="1"/><line x1="1" y1="7" x2="4" y2="7" stroke="#a78bfa" stroke-width="1"/><line x1="10" y1="7" x2="13" y2="7" stroke="#a78bfa" stroke-width="1"/>',
  clearRoi: '<circle cx="7" cy="7" r="3" fill="none" stroke="#666" stroke-width="1.2"/><line x1="3" y1="3" x2="11" y2="11" stroke="#ef4444" stroke-width="1.5"/>',
  home: '<path d="M2,7 L7,2 L12,7 L12,12 L2,12 Z" fill="none" stroke="#f59e0b" stroke-width="1.2"/><rect x="5" y="8" width="4" height="4" fill="none" stroke="#f59e0b" stroke-width="1"/>',
  ekf: '<circle cx="7" cy="7" r="5" fill="none" stroke="#f59e0b" stroke-width="1.2"/><line x1="7" y1="4" x2="7" y2="10" stroke="#f59e0b" stroke-width="1"/><line x1="4" y1="7" x2="10" y2="7" stroke="#f59e0b" stroke-width="1"/>',
  rally: '<polygon points="7,2 9,6 13,6 10,9 11,13 7,10.5 3,13 4,9 1,6 5,6" fill="none" stroke="#22c55e" stroke-width="1"/>',
  poi: '<circle cx="7" cy="5" r="3" fill="none" stroke="#DFF140" stroke-width="1.2"/><path d="M7,8 L7,13" stroke="#DFF140" stroke-width="1.2"/>',
  heading: '<path d="M7,2 L7,12 M4,5 L7,2 L10,5" fill="none" stroke="#3A82FF" stroke-width="1.2"/>',
  copy: '<rect x="4" y="4" width="7" height="8" rx="1" fill="none" stroke="#888" stroke-width="1"/><rect x="3" y="2" width="7" height="8" rx="1" fill="none" stroke="#888" stroke-width="1"/>',
  measure: '<line x1="2" y1="12" x2="12" y2="2" stroke="#888" stroke-width="1.2"/><line x1="2" y1="12" x2="2" y2="9" stroke="#888" stroke-width="1"/><line x1="2" y1="12" x2="5" y2="12" stroke="#888" stroke-width="1"/>',
};

// ── Component ───────────────────────────────────────────────

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
  // React's stopPropagation doesn't work because Leaflet uses its own
  // event system (L.DomEvent) that runs in parallel with DOM events.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  });

  const connectionState = useDroneStore((s) => s.connectionState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const frameType = useDroneStore((s) => s.frameType);
  const showConfirm = useGuidedStore((s) => s.showConfirm);
  const confirmPending = useGuidedStore((s) => s.confirmPending);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const addRally = useRallyStore((s) => s.addPoint);
  const uploadRally = useRallyStore((s) => s.uploadRallyPoints);
  const addPoi = usePoiStore((s) => s.addMarker);

  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  const isConnected = connectionState === "connected" || connectionState === "armed" || connectionState === "in_flight";
  const isArmed = armState === "armed";
  const canNavigate = isConnected && isArmed && GUIDED_MODES.has(flightMode);
  const isCopter = frameType === "copter" || frameType === "heli";

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

  // ── Menu items (context-aware visibility) ───────────────

  const menuItems = useMemo((): MenuItemDef[] => {
    const items: MenuItemDef[] = [];

    // Group 0: Navigation
    if (canNavigate) {
      items.push({ id: "fly-here", label: "Fly Here", icon: "flyHere", group: 0, shortcut: "G" });
      items.push({ id: "fly-here-alt", label: "Fly Here at Alt...", icon: "flyHereAlt", group: 0 });
    }
    if (canNavigate && isCopter) {
      items.push({ id: "orbit-here", label: "Orbit Here...", icon: "orbit", group: 0, shortcut: "O" });
    }
    if (canNavigate) {
      items.push({ id: "loiter-here", label: "Loiter Here", icon: "loiter", group: 0 });
      items.push({ id: "land-here", label: "Land Here", icon: "land", group: 0 });
    }

    // Group 1: Camera/Gimbal
    if (isConnected) {
      items.push({ id: "point-camera", label: "Point Camera Here", icon: "roi", group: 1 });
      items.push({ id: "clear-roi", label: "Clear Camera ROI", icon: "clearRoi", group: 1 });
      items.push({ id: "trigger-camera", label: "Trigger Camera", icon: "camera", group: 1 });
    }

    // Group 2: Home/Origin
    if (isConnected) {
      items.push({ id: "set-home", label: "Set Home Here", icon: "home", group: 2 });
      items.push({ id: "set-ekf-origin", label: "Set EKF Origin", icon: "ekf", group: 2 });
    }

    // Group 3: Markers
    if (isConnected) {
      items.push({ id: "add-rally", label: "Add Rally Point", icon: "rally", group: 3 });
    }
    items.push({ id: "add-poi", label: "Add POI Marker", icon: "poi", group: 3 });
    if (isConnected && isArmed && GUIDED_MODES.has(flightMode)) {
      items.push({ id: "set-heading", label: "Set Heading Toward", icon: "heading", group: 3 });
    }

    // Group 4: Utility
    items.push({ id: "copy-coords", label: "Copy Coordinates", icon: "copy", group: 4 });
    if (isConnected && latestPos && latestPos.lat !== 0) {
      items.push({ id: "measure-from-drone", label: "Measure from Drone", icon: "measure", group: 4 });
    }

    return items;
  }, [canNavigate, isConnected, isArmed, isCopter, flightMode, latestPos]);

  // ── Distance and bearing calculations ───────────────────

  const dist = useMemo(() => {
    if (!menuPos || !latestPos) return 0;
    return haversineDistance(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
  }, [menuPos, latestPos]);

  const bearingToDrone = useMemo(() => {
    if (!menuPos || !latestPos) return 0;
    return bearing(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
  }, [menuPos, latestPos]);

  const distLabel = dist < 1000
    ? `${Math.round(dist)} m`
    : `${(dist / 1000).toFixed(2)} km`;

  // ── Action handler ──────────────────────────────────────

  const handleAction = useCallback((id: string) => {
    if (!menuPos) return;
    const protocol = getProtocol();
    const rect = map.getContainer().getBoundingClientRect();

    switch (id) {
      case "fly-here": {
        showConfirm(menuPos.lat, menuPos.lon, rect.left + menuPos.x, rect.top + menuPos.y);
        break;
      }
      case "fly-here-alt": {
        // Same as fly-here but opens confirm dialog which has altitude picker
        showConfirm(menuPos.lat, menuPos.lon, rect.left + menuPos.x, rect.top + menuPos.y);
        break;
      }
      case "orbit-here": {
        setOrbitOpen(true);
        return; // Don't close menu
      }
      case "loiter-here": {
        if (protocol) {
          protocol.setFlightMode("LOITER");
          protocol.guidedGoto(menuPos.lat, menuPos.lon, latestPos?.relativeAlt ?? 10);
        }
        break;
      }
      case "land-here": {
        if (protocol) {
          protocol.guidedGoto(menuPos.lat, menuPos.lon, latestPos?.relativeAlt ?? 10);
          setTimeout(() => protocol.land(), 500);
        }
        break;
      }
      case "point-camera": {
        if (protocol?.setRoiLocation) {
          protocol.setRoiLocation(menuPos.lat, menuPos.lon, latestPos?.relativeAlt ?? 0);
        } else if (protocol?.setGimbalROI) {
          protocol.setGimbalROI(menuPos.lat, menuPos.lon, latestPos?.relativeAlt ?? 0);
        }
        break;
      }
      case "clear-roi": {
        if (protocol?.clearRoi) protocol.clearRoi();
        break;
      }
      case "trigger-camera": {
        if (protocol) protocol.cameraTrigger();
        break;
      }
      case "set-home": {
        setConfirmHomeOpen(true);
        return; // Don't close menu
      }
      case "set-ekf-origin": {
        if (protocol?.setEkfOrigin) {
          protocol.setEkfOrigin(menuPos.lat, menuPos.lon, 0);
        }
        break;
      }
      case "add-rally": {
        addRally({
          id: `rally-${Date.now()}`,
          lat: menuPos.lat,
          lon: menuPos.lon,
          alt: latestPos?.relativeAlt ?? 30,
        });
        uploadRally();
        break;
      }
      case "add-poi": {
        setPoiInput(true);
        setTimeout(() => poiInputRef.current?.focus(), 50);
        return; // Don't close menu
      }
      case "set-heading": {
        if (protocol && latestPos) {
          const brng = bearing(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
          protocol.setYaw(brng, 30, 1, false);
        }
        break;
      }
      case "copy-coords": {
        navigator.clipboard.writeText(`${menuPos.lat.toFixed(7)}, ${menuPos.lon.toFixed(7)}`);
        break;
      }
      case "measure-from-drone": {
        // Already shown in footer, but this highlights it
        navigator.clipboard.writeText(
          `${distLabel} at ${Math.round(bearingToDrone)}°`
        );
        break;
      }
    }
    closeMenu();
  }, [menuPos, getProtocol, map, showConfirm, latestPos, addRally, uploadRally, addPoi, closeMenu, distLabel, bearingToDrone]);

  // ── Orbit confirm ───────────────────────────────────────

  const handleOrbitConfirm = useCallback(() => {
    if (!menuPos) return;
    const protocol = getProtocol();
    if (protocol?.orbit) {
      const radius = orbitCw ? orbitRadius : -orbitRadius;
      protocol.orbit(radius, 2, 2, menuPos.lat, menuPos.lon, latestPos?.relativeAlt ?? 20);
    }
    closeMenu();
  }, [menuPos, getProtocol, orbitRadius, orbitCw, latestPos, closeMenu]);

  // ── Set Home confirm ────────────────────────────────────

  const handleHomeConfirm = useCallback(() => {
    if (!menuPos) return;
    const protocol = getProtocol();
    if (protocol) {
      protocol.setHome(false, menuPos.lat, menuPos.lon, 0);
    }
    closeMenu();
  }, [menuPos, getProtocol, closeMenu]);

  // ── POI confirm ─────────────────────────────────────────

  const handlePoiConfirm = useCallback(() => {
    if (!menuPos) return;
    addPoi(menuPos.lat, menuPos.lon, poiLabel);
    closeMenu();
  }, [menuPos, addPoi, poiLabel, closeMenu]);

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
      {/* Orbit sub-panel */}
      {orbitOpen && (
        <div className="px-3 py-2 border-b border-border-default">
          <div className="text-[10px] font-mono text-text-secondary mb-1.5">Orbit Configuration</div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-[9px] text-text-tertiary w-12">Radius</label>
            <input
              type="number"
              value={orbitRadius}
              onChange={(e) => setOrbitRadius(Math.max(5, Math.min(500, Number(e.target.value))))}
              min={5}
              max={500}
              step={5}
              className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none"
            />
            <span className="text-[9px] text-text-tertiary">m</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[9px] text-text-tertiary w-12">Direction</label>
            <div className="flex gap-1">
              <button
                onClick={() => setOrbitCw(true)}
                className={`px-2 py-0.5 text-[9px] font-mono rounded border cursor-pointer ${
                  orbitCw ? "bg-accent-primary/20 border-accent-primary text-accent-primary" : "border-border-default text-text-tertiary"
                }`}
              >
                CW
              </button>
              <button
                onClick={() => setOrbitCw(false)}
                className={`px-2 py-0.5 text-[9px] font-mono rounded border cursor-pointer ${
                  !orbitCw ? "bg-accent-primary/20 border-accent-primary text-accent-primary" : "border-border-default text-text-tertiary"
                }`}
              >
                CCW
              </button>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleOrbitConfirm}
              className="flex-1 px-2 py-1 text-[10px] font-mono font-semibold bg-accent-primary/20 border border-accent-primary/40 text-accent-primary rounded hover:bg-accent-primary/30 cursor-pointer"
            >
              Start Orbit
            </button>
            <button
              onClick={() => setOrbitOpen(false)}
              className="px-2 py-1 text-[10px] font-mono text-text-tertiary border border-border-default rounded hover:text-text-primary cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Set Home confirmation */}
      {confirmHomeOpen && (
        <div className="px-3 py-2 border-b border-border-default">
          <div className="text-[10px] font-mono text-status-warning mb-1.5">Confirm: Set Home Here?</div>
          <div className="text-[9px] text-text-tertiary mb-2">
            This will change the home location. RTL and failsafe will use this new position.
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleHomeConfirm}
              className="flex-1 px-2 py-1 text-[10px] font-mono font-semibold bg-status-warning/20 border border-status-warning/40 text-status-warning rounded hover:bg-status-warning/30 cursor-pointer"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmHomeOpen(false)}
              className="px-2 py-1 text-[10px] font-mono text-text-tertiary border border-border-default rounded hover:text-text-primary cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* POI label input */}
      {poiInput && (
        <div className="px-3 py-2 border-b border-border-default">
          <div className="text-[10px] font-mono text-text-secondary mb-1.5">POI Label</div>
          <div className="flex gap-1">
            <input
              ref={poiInputRef}
              type="text"
              value={poiLabel}
              onChange={(e) => setPoiLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePoiConfirm();
                if (e.key === "Escape") { setPoiInput(false); setPoiLabel(""); }
              }}
              placeholder="Marker name..."
              className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none placeholder:text-text-tertiary/50"
            />
            <button
              onClick={handlePoiConfirm}
              className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-[#DFF140]/20 border border-[#DFF140]/40 text-[#DFF140] rounded hover:bg-[#DFF140]/30 cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Menu items */}
      {!orbitOpen && !confirmHomeOpen && !poiInput && sortedGroups.map((group, gi) => {
        const groupItems = menuItems.filter((i) => i.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            {gi > 0 && <div className="border-t border-border-default" />}
            {groupItems.map((item) => {
              const idx = menuItems.indexOf(item);
              return (
                <button
                  key={item.id}
                  onClick={() => handleAction(item.id)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors flex items-center gap-2.5 cursor-pointer ${
                    highlightIdx === idx
                      ? "bg-bg-tertiary text-text-primary"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  } ${item.danger ? "text-status-error" : ""}`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0" dangerouslySetInnerHTML={{ __html: ICONS[item.icon] || "" }} />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="text-[9px] text-text-tertiary">{item.shortcut}</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}

      {/* Coordinate + distance footer */}
      <div className="border-t border-border-default" />
      <div className="px-3 py-1 text-[9px] font-mono text-text-tertiary flex justify-between items-center">
        <span>{menuPos.lat.toFixed(6)}, {menuPos.lon.toFixed(6)}</span>
        <span className="flex items-center gap-1.5">
          {dist > 0 && <span>{distLabel}</span>}
          {dist > 0 && bearingToDrone > 0 && <span>{Math.round(bearingToDrone)}°</span>}
        </span>
      </div>
    </div>
  );
}
