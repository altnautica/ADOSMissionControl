import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import messages from "../../../../locales/en.json";
import { NavSourceChip } from "@/components/cockpit/NavSourceChip";
import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import { EKF_FLAG } from "@/lib/hud/nav-source";
import { useDroneManager } from "@/stores/drone-manager";
import { useEkfSourceStore } from "@/stores/ekf-source-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const DRONE = "node:nav-chip";
const setEkfSourceSet = vi.fn(async () => ({ ok: true as const }));

function pushEkf(flags: number, ageMs = 0) {
  useTelemetryStore.getState().pushEkf({
    timestamp: Date.now() - ageMs,
    velocityVariance: 0.1,
    posHorizVariance: 0.1,
    posVertVariance: 0.1,
    compassVariance: 0.1,
    terrainAltVariance: 0,
    flags,
  });
}

function pushGps(fixType: number) {
  useTelemetryStore.getState().pushGps({
    timestamp: Date.now(),
    fixType,
    satellites: 14,
    hdop: 0.9,
    lat: 0,
    lon: 0,
    alt: 0,
  });
}

function setSrc(posxy: number, velxy: number) {
  useEkfSourceStore.getState().setParams(DRONE, {
    EK3_SRC1_POSXY: posxy,
    EK3_SRC1_VELXY: velxy,
    EK3_SRC1_YAW: 1,
    EK3_SRC2_POSXY: 6,
    EK3_SRC2_VELXY: 6,
    EK3_SRC2_YAW: 6,
  });
}

function renderChip(widthClass: CockpitWidthClass = "expanded") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitLayoutContext.Provider value={{ widthClass, width: 1280, height: 720 }}>
        <div className="ados-cockpit">
          <NavSourceChip droneId={DRONE} />
        </div>
      </CockpitLayoutContext.Provider>
    </NextIntlClientProvider>,
  );
}

const chip = () => screen.getByTestId("cockpit-nav");

describe("NavSourceChip", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useEkfSourceStore.setState({ lastCommanded: {}, params: {} });
    useNavStreamStore.getState().clear(DRONE);
    useDroneManager.setState({
      drones: new Map([[DRONE, { protocol: { isConnected: false, setEkfSourceSet } }]]),
    } as never);
    setEkfSourceSet.mockClear();
    mocks.toast.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reads NAV — (muted) with no fresh EKF report", () => {
    pushEkf(EKF_FLAG.VEL_H | EKF_FLAG.POS_H_ABS, 3000);
    renderChip();
    expect(chip().textContent).toContain("NAV —");
    expect(chip().getAttribute("data-tone")).toBe("muted");
  });

  it("reads DR DRIFT when the EKF holds a constant position", () => {
    pushEkf(EKF_FLAG.CONST_POS);
    renderChip();
    expect(chip().getAttribute("data-kind")).toBe("dr");
    expect(chip().textContent).toContain("DR");
    expect(chip().textContent).toContain("DRIFT");
    expect(chip().getAttribute("data-tone")).toBe("crit");
  });

  it("reads the GPS fix and quality from the active set", () => {
    setSrc(3, 3);
    pushGps(3);
    pushEkf(EKF_FLAG.VEL_H | EKF_FLAG.POS_H_ABS);
    renderChip();
    expect(chip().textContent).toContain("GPS 3D·14");
    expect(chip().textContent).toContain("GOOD");
    expect(chip().getAttribute("data-tone")).toBe("good");
  });

  it("reads EXT NAV with the companion's health", () => {
    setSrc(6, 6);
    useNavStreamStore.getState().setNav(DRONE, {
      mode: "external_nav",
      activeSet: 1,
      extnavHealth: "degraded",
      odomRateHz: 30,
      lastResetCounter: 0,
      obstacleRateHz: null,
      minObstacleM: null,
      gpsFix: null,
    });
    pushEkf(EKF_FLAG.VEL_H | EKF_FLAG.POS_H_REL);
    renderChip();
    expect(chip().textContent).toContain("EXT NAV");
    expect(chip().textContent).toContain("DEGRADED");
    expect(chip().getAttribute("data-tone")).toBe("warn");
  });

  it("reads FLOW, and drops the quality word at compact", () => {
    setSrc(0, 5);
    pushEkf(EKF_FLAG.VEL_H);
    renderChip("compact");
    expect(chip().textContent).toContain("FLOW");
    expect(chip().textContent).not.toContain("HOLD OK");
    expect(chip().getAttribute("data-tone")).toBe("good");
  });

  it("switches source set through a hold-to-confirm and records it", async () => {
    setSrc(3, 3);
    pushGps(3);
    pushEkf(EKF_FLAG.VEL_H | EKF_FLAG.POS_H_ABS);
    renderChip();
    fireEvent.click(chip().querySelector("button")!);
    const pop = screen.getByTestId("nav-source-popover");
    expect(screen.getByTestId("nav-set-1").textContent).toContain("ACTIVE");
    expect(screen.getByTestId("nav-set-2").textContent).toContain("ExternalNav");
    expect(pop.textContent).toContain("VEL H");

    vi.useFakeTimers();
    fireEvent.click(screen.getByText("Use set 2"));
    const hold = pop.querySelector("[data-hold-control='true']")!;
    // A click alone never switches.
    fireEvent.click(hold);
    expect(setEkfSourceSet).not.toHaveBeenCalled();
    fireEvent.pointerDown(hold, { pointerId: 1 });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(setEkfSourceSet).toHaveBeenCalledWith(2);
    expect(useEkfSourceStore.getState().lastCommanded[DRONE]).toBe(2);
    expect(mocks.toast).toHaveBeenCalledWith("EKF source set 2 active", "success");
  });

  it("notes automatic switching while vision-nav runs external nav", () => {
    setSrc(6, 6);
    useNavStreamStore.getState().setNav(DRONE, {
      mode: "external_nav",
      activeSet: 2,
      extnavHealth: "good",
      odomRateHz: 30,
      lastResetCounter: 0,
      obstacleRateHz: null,
      minObstacleM: null,
      gpsFix: null,
    });
    pushEkf(EKF_FLAG.VEL_H | EKF_FLAG.POS_H_REL);
    renderChip();
    fireEvent.click(chip().querySelector("button")!);
    expect(screen.getByText(messages.hud.nav.autoSwitch)).toBeTruthy();
    expect(screen.getByTestId("nav-set-2").textContent).toContain("ACTIVE");
  });
});
