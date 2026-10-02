/**
 * @license GPL-3.0-only
 * MissionAdvisories RTL rows: the return-leg terrain advisory only surfaces when
 * home coordinates, terrain elevation and the vehicle's configured return
 * altitude are genuinely available, renders the pure module's own messages,
 * and says the check did not run when the return altitude is unknown.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
const getElevation = vi.fn<(lat: number, lon: number) => Promise<number | null>>(async () => null);
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: (lat: number, lon: number) => getElevation(lat, lon),
}));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { MissionAdvisories } from "@/components/planner/MissionAdvisories";
import { useGeofenceStore } from "@/stores/geofence-store";
import { selectTestProtocol } from "../../../../tests/helpers/selected-drone";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { RingBuffer } from "@/lib/ring-buffer";
import type { Waypoint, HomePositionData } from "@/lib/types";

function wp(
  id: string,
  lat: number,
  lon: number,
  groundElevation?: number,
): Waypoint {
  return { id, lat, lon, alt: 50, command: "WAYPOINT", groundElevation };
}

const noop = () => {};

/** A copter whose RTL_ALT is 30 m (the parameter is in centimetres). */
function copterWithRtlAlt(cm = 3000) {
  const protocol = {
    getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
    getParameter: vi.fn(async (name: string) => ({ name, value: cm, type: 9, index: 0, count: 1 })),
  };
  selectTestProtocol(protocol);
  return protocol;
}

beforeEach(() => {
  getElevation.mockReset();
  getElevation.mockResolvedValue(null);
  useGeofenceStore.setState({ enabled: false });
  selectTestProtocol(null);
  useTelemetryStore.setState({
    homePosition: new RingBuffer<HomePositionData>(12),
  });
});

describe("MissionAdvisories — RTL return terrain", () => {
  it("flags a return leg that clips terrain at the vehicle's RTL altitude", async () => {
    // Home falls back to WP1 (900 m MSL terrain); WP2 sits over 1000 m terrain.
    // The vehicle's 30 m return altitude (cruise 930 m MSL) is below the 1000 m
    // ridge on the direct leg home, so the module emits an error for WP2.
    const protocol = copterWithRtlAlt();
    const waypoints = [
      wp("a", 12.9716, 77.5946, 900),
      wp("b", 13.0716, 77.5946, 1000),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP2 would clip terrain/i),
    ).toBeInTheDocument();
    expect(protocol.getParameter).toHaveBeenCalledWith("RTL_ALT");
    expect(screen.getByText("rtl.returnAltitudeFromVehicle")).toBeInTheDocument();
  });

  it("reports the return-leg check as not run when no RTL altitude was read", () => {
    // The same clipping mission with no vehicle: no altitude is assumed, so no
    // RTL row claims a clearance either way.
    const waypoints = [
      wp("a", 12.9716, 77.5946, 900),
      wp("b", 13.0716, 77.5946, 1000),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(screen.queryByText(/RTL from/i)).toBeNull();
    expect(screen.getByText("rtl.returnAltitudeUnknown")).toBeInTheDocument();
  });

  it("renders no RTL rows when terrain elevation is unknown", () => {
    // No waypoint carries groundElevation → the module returns [] → no RTL rows,
    // even though the always-informative item-count row keeps the panel visible.
    const waypoints = [wp("a", 12.9716, 77.5946), wp("b", 13.0716, 77.5946)];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(screen.queryByText(/RTL from/i)).toBeNull();
    expect(screen.queryByText("rtl.returnAltitudeUnknown")).toBeNull();
  });

  it("takes the RTL datum from the terrain under the telemetry home, not WP1", async () => {
    // Launch from a 100 m valley; the mission flies a 300 m plateau 8 km north.
    // The return cruise is 30 m above home's ground (130 m MSL), straight into
    // the plateau. Pairing home with WP1's 300 m ground would hide it.
    const home = new RingBuffer<HomePositionData>(12);
    home.push({ timestamp: Date.now(), lat: 12.9, lon: 77.5946, alt: 100 });
    useTelemetryStore.setState({ homePosition: home });
    getElevation.mockResolvedValue(100);
    copterWithRtlAlt();

    const waypoints = [
      wp("a", 12.9716, 77.5946, 300),
      wp("b", 12.9816, 77.5946, 300),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP1 would clip terrain: the 130 m MSL/i),
    ).toBeInTheDocument();
    expect(getElevation).toHaveBeenCalledWith(12.9, 77.5946);
  });

  it("uses WP1's coordinates and terrain together when home has no terrain sample", async () => {
    // Home is reported 8 km south but its terrain lookup fails: the datum falls
    // back to WP1 (both position and ground), so WP1 itself raises no return leg.
    const home = new RingBuffer<HomePositionData>(12);
    home.push({ timestamp: Date.now(), lat: 12.9, lon: 77.5946, alt: 100 });
    useTelemetryStore.setState({ homePosition: home });
    copterWithRtlAlt();

    const waypoints = [
      wp("a", 12.9716, 77.5946, 300),
      wp("b", 12.9816, 77.5946, 400),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP2 would clip terrain: the 330 m MSL/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/RTL from WP1/i)).toBeNull();
  });
});

describe("MissionAdvisories — DO_LAND_START on a plane", () => {
  function planeWithAutoland(value: number) {
    const protocol = {
      getVehicleInfo: () => ({ firmwareType: "ardupilot-plane" }),
      getParameter: vi.fn(async (name: string) => ({ name, value, type: 9, index: 0, count: 1 })),
    };
    selectTestProtocol(protocol);
    return protocol;
  }

  const landing: Waypoint[] = [
    wp("a", 12.9716, 77.5946),
    { id: "ls", lat: 12.97, lon: 77.6, alt: 60, command: "DO_LAND_START" },
    wp("app", 12.97, 77.6),
    { id: "l", lat: 12.975, lon: 77.6, alt: 0, command: "LAND" },
  ];

  it("warns that the plane will refuse to arm when RTL_AUTOLAND is 0", async () => {
    const protocol = planeWithAutoland(0);
    render(<MissionAdvisories waypoints={landing} onSelectWaypoint={noop} />);
    expect(await screen.findByText("rtl.landStartNeedsAutoland")).toBeInTheDocument();
    expect(protocol.getParameter).toHaveBeenCalledWith("RTL_AUTOLAND");
  });

  it("stays quiet when RTL_AUTOLAND lands through the marker", async () => {
    const protocol = planeWithAutoland(2);
    render(<MissionAdvisories waypoints={landing} onSelectWaypoint={noop} />);
    await vi.waitFor(() => expect(protocol.getParameter).toHaveBeenCalled());
    expect(screen.queryByText("rtl.landStartNeedsAutoland")).toBeNull();
  });
});
