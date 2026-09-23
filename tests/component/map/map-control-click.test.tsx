/**
 * A click on React UI inside the map (a corner control) must not also reach
 * Leaflet as a map click, or placement tools drop a point under the button.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MapContainer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

import { MapContextMenu } from "@/components/map/MapContextMenu";
import { MapControl } from "@/components/map/MapControl";

afterEach(cleanup);

function ClickProbe({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: onMapClick });
  return null;
}

describe("MapControl", () => {
  it("keeps a click on the control from firing a map click", () => {
    let mapClicks = 0;
    const { getByRole, container } = render(
      <MapContainer center={[12.97, 77.59]} zoom={14} style={{ width: 400, height: 300 }}>
        <ClickProbe onMapClick={() => (mapClicks += 1)} />
        <MapControl className="leaflet-top leaflet-right">
          <button type="button">SAT</button>
        </MapControl>
      </MapContainer>,
    );

    fireEvent.click(getByRole("button", { name: "SAT" }));
    expect(mapClicks).toBe(0);

    // The probe does see a click on the map itself.
    fireEvent.click(container.querySelector(".leaflet-container") as HTMLElement);
    expect(mapClicks).toBe(1);
  });
});

describe("MapContextMenu", () => {
  it("stays open and anchored while the map pans under it, and closes on a user drag", () => {
    // happy-dom does no layout; give the map container a size so the menu's
    // edge clamp does not pin it.
    for (const prop of ["clientWidth", "clientHeight"] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1000 });
    }
    const mapRef: { current: L.Map | null } = { current: null };
    function Grab() {
      const m = useMap();
      useEffect(() => {
        mapRef.current = m;
      }, [m]);
      return null;
    }
    const { container } = render(
      <MapContainer center={[12.97, 77.59]} zoom={14} style={{ width: 400, height: 300 }}>
        <Grab />
        <MapContextMenu />
      </MapContainer>,
    );
    const m = mapRef.current as L.Map;
    const latlng = L.latLng(12.971, 77.591);
    act(() => {
      m.fire("contextmenu", { latlng, originalEvent: { preventDefault() {} } });
    });
    const menu = () => container.querySelector(".z-\\[2000\\]") as HTMLElement | null;
    expect(menu()).not.toBeNull();
    const leftBefore = menu()!.style.left;

    // Follow mode re-centres on the vehicle: a programmatic pan.
    act(() => {
      m.panBy([60, 0], { animate: false });
    });
    expect(menu()).not.toBeNull();
    expect(menu()!.style.left).not.toBe(leftBefore);

    act(() => {
      m.fire("dragstart");
    });
    expect(menu()).toBeNull();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });
});
