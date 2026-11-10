/**
 * @license GPL-3.0-only
 *
 * The top bar's link cell reads the age of the newest vehicle frame
 * (`cockpit.link.age`, or `cockpit.link.never` before any), its icon ok
 * under 3 s, warning under 10 s and critical after (layout.json
 * `top_bar.link`); RSSI lives in the link popover. The battery cell reads
 * the time to the reserve in the spec's words, short when the bar is short
 * of room.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const reserve = vi.hoisted(() => ({ value: null as null | { etaS: number | null; past: boolean; reservePct: number } }));
vi.mock("../../band/use-band-reserve", () => ({ useBandReserve: () => reserve.value }));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { specString } from "@/lib/cockpit/spec-strings";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useFlightSheetStore } from "../flight-sheet";
import { BatteryCell, LinkCell, linkAgeView } from "../TopBarCells";

const DRONE = "link-battery";
const NOW = 1_800_000_000_000;

function radio(): void {
  useTelemetryStore.getState().pushRadio({
    timestamp: Date.now(),
    rssi: -61,
    remrssi: -58,
    txbuf: 100,
    noise: 20,
    remnoise: 22,
    rxerrors: 0,
    fixed: 0,
    sourceSystemId: 51,
  } as never);
}

afterEach(() => {
  cleanup();
  reserve.value = null;
  useTelemetryStore.getState().clear();
  useDroneStore.setState({ lastHeartbeat: 0 } as never);
  useFlightSheetStore.setState({ open: null });
});

describe("link age", () => {
  it("reads no link before any vehicle frame", () => {
    expect(linkAgeView(0, NOW)).toEqual({ text: specString("cockpit.link.never"), severity: "none" });
  });

  it.each([
    [0, "0 s", "ok"],
    [2_999, "2 s", "ok"],
    [3_000, "3 s", "warning"],
    [9_999, "9 s", "warning"],
    [10_000, "10 s", "critical"],
    [75_400, "75 s", "critical"],
  ] as const)("a frame %i ms old reads %s, icon %s", (age, text, severity) => {
    expect(linkAgeView(NOW - age, NOW)).toEqual({ text, severity });
  });

  it("shows the age as the link text and colours the icon, keeping RSSI out of the bar", () => {
    radio();
    useDroneStore.setState({ lastHeartbeat: Date.now() - 4_500 } as never);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.getByTestId("fs-link-detail").textContent).toBe(specString("cockpit.link.age", { s: 4 }));
    const icon = screen.getByTestId("fs-link-icon");
    expect(icon.getAttribute("data-severity")).toBe("warning");
    const bars = [...icon.children].map((b) => (b as HTMLElement).style.background);
    expect(bars.every((c) => c === "var(--fs-warn)" || c === "var(--fs-border)")).toBe(true);
    expect(screen.getByTestId("fs-link").textContent).not.toContain("-61");
  });

  it.each([
    [1_000, "var(--fs-ok)"],
    [4_000, "var(--fs-warn)"],
    [12_000, "var(--fs-crit)"],
  ] as const)("colours the lit icon bars by the age of the newest frame (%i ms)", (age, color) => {
    useDroneStore.setState({ lastHeartbeat: Date.now() - age } as never);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    const bars = [...screen.getByTestId("fs-link-icon").children].map((b) => (b as HTMLElement).style.background);
    expect(bars).toContain(color);
    expect(screen.getByTestId("fs-link-detail").style.color).toBe(color);
  });

  it("reads no link with no frame yet", () => {
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.getByTestId("fs-link-detail").textContent).toBe(specString("cockpit.link.never"));
  });

  it("opens the link popover below the top bar with the RSSI", () => {
    radio();
    useDroneStore.setState({ lastHeartbeat: Date.now() } as never);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.queryByTestId("fs-link-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("fs-link"));
    const pop = screen.getByTestId("fs-link-popover");
    expect(pop.style.top).toBe("calc(var(--fs-bar-b, 0px) + 8px)");
    expect(screen.getByTestId("fs-link-rssi").textContent).toBe(specString("cockpit.link.rssi", { v: -61 }));
  });

  it("shows the RSSI inline in the Menu's overflow section", () => {
    radio();
    useDroneStore.setState({ lastHeartbeat: Date.now() } as never);
    renderWithIntl(<LinkCell droneId={DRONE} detail inMenu />);
    expect(screen.getByTestId("fs-link-rssi").textContent).toBe("RSSI -61");
  });
});

describe("battery time to reserve", () => {
  it("reads the full form on a roomy bar and the short form on a short one", () => {
    reserve.value = { etaS: 754, past: false, reservePct: 25 };
    renderWithIntl(<BatteryCell droneId={DRONE} />);
    expect(screen.getByTestId("fs-battery-left").textContent).toBe(specString("battery.to_reserve", { t: "12:34" }));
    expect(screen.getByTestId("fs-battery-left").textContent).toBe("12:34 to reserve");
    cleanup();
    renderWithIntl(<BatteryCell droneId={DRONE} short />);
    expect(screen.getByTestId("fs-battery-left").textContent).toBe(specString("battery.to_reserve_short", { t: "12:34" }));
    expect(screen.getByTestId("fs-battery-left").textContent).toBe("12:34 RES");
  });

  it("names the reserve time in the cell's accessible name and marks a passed reserve with the critical text colour", () => {
    reserve.value = { etaS: 0, past: true, reservePct: 25 };
    renderWithIntl(<BatteryCell droneId={DRONE} />);
    const left = screen.getByTestId("fs-battery-left");
    expect(left.className).toContain("fs-text-crit");
    expect(screen.getByTestId("fs-battery").getAttribute("aria-label")).toContain("0:00 to reserve");
  });
});
