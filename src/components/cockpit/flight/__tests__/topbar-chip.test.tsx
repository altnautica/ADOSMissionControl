/**
 * @license GPL-3.0-only
 *
 * The flight-state chip takes at most 40 % of the top bar and ends a longer
 * text in an ellipsis, with the full text in its title and accessible name
 * (`chip.aria`). At the compact classes it shows its compact face (the state
 * text alone). Its action button reads the spec's words.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { specString } from "@/lib/cockpit/spec-strings";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightStateChip } from "../../v2/FlightStateChip";

const DRONE = "topbar-chip";

function pin(over: Record<string, unknown> = {}) {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now());
}

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
});

describe("flight-state chip in the top bar", () => {
  it("is capped at 40 % of the bar with an ellipsis and the full text in title and aria", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    const wrap = screen.getByTestId("flight-state-chip");
    expect(wrap.getAttribute("data-max-frac")).toBe("0.4");
    expect(wrap.style.maxWidth).toBe("400px");
    expect(wrap.style.minWidth).toMatch(/^0(px)?$/);

    const text = screen.getByTestId("flight-state-chip-text");
    expect(text.className).toBe("fs-chip-text");
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const textRule = css.match(/\.ados-cockpit \.fs-chip-text \{([^}]*)\}/)?.[1] ?? "";
    expect(textRule).toContain("text-overflow: ellipsis");
    expect(textRule).toContain("overflow: hidden");

    const button = wrap.querySelector("button")!;
    const title = button.getAttribute("title")!;
    expect(title.startsWith(text.textContent!)).toBe(true);
    expect(title).toContain("ADOS Pilot");
    expect(button.getAttribute("aria-label")).toBe(specString("chip.aria", { text: title }));
  });

  it("says the reduced update rate in words while the nav stream is polled over the radio", () => {
    pin();
    useNavStreamStore.getState().setTransport(DRONE, "poll");
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    const words = specString("nav.reduced_rate");
    expect(screen.getByTestId("flight-state-chip-reduced-rate").textContent).toContain(words);
    expect(screen.getByTestId("flight-state-chip").querySelector("button")!.getAttribute("title")).toContain(words);
  });

  it("shows the compact face only at the compact classes, keeping the full text in its title", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={560} compact />);
    const wrap = screen.getByTestId("flight-state-chip");
    expect(wrap.getAttribute("data-face")).toBe("compact");
    expect(wrap.style.maxWidth).toBe("224px");
    expect(wrap.querySelector(".fs-chip-sub")).toBeNull();
    expect(wrap.querySelector("button")!.getAttribute("title")).toContain("ADOS Pilot");
  });

  it("shows the secondary line on the full face", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    expect(screen.getByTestId("flight-state-chip").querySelector(".fs-chip-sub")?.textContent).toContain("ADOS Pilot");
  });

  it("puts the state and then the secondary facts on one line, joined by ' · ', in the spec's casing", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    const text = screen.getByTestId("flight-state-chip-text").textContent!;
    const title = screen.getByTestId("flight-state-chip").querySelector("button")!.getAttribute("title")!;
    expect(screen.getByTestId("flight-state-chip-sub").textContent).toBe(title.slice(text.length));
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    // Every rule for exactly this selector, joined.
    const rule = (sel: string) =>
      [...css.matchAll(new RegExp(`\\.ados-cockpit ${sel} \\{([^}]*)\\}`, "g"))].map((m) => m[1]).join(";");
    expect(rule("\\.fs-chip")).toContain("flex-direction: row");
    expect(rule("\\.fs-chip-sub")).not.toContain("text-transform");
    expect(rule("\\.fs-chip-sub")).toContain("var(--fs-text-dim)");
  });

  it("keeps the chip's hit-area border and a wrap at least the chip's height", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const rules = (sel: string) =>
      [...css.matchAll(new RegExp(`\\.ados-cockpit ${sel} \\{([^}]*)\\}`, "g"))].map((m) => m[1]);
    // A later shorthand `border: 0` would drop the transparent block border
    // that offsets the negative margin, and clip the text.
    for (const body of rules("\\.fs-chip")) expect(body).not.toMatch(/(^|[;\s])border:\s*0/);
    expect(rules("\\.fs-chip-wrap").join(";")).toContain("min-height: var(--fs-control)");
  });

  it("draws the state colour as a dot and an outline, the words in the chrome text colour", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    expect(screen.getByTestId("flight-state-chip-dot").className).toBe("fs-dot");
    expect(screen.getByTestId("flight-state-chip-text").getAttribute("style")).toBeNull();
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const chip = [...css.matchAll(/\.ados-cockpit \.fs-chip \{([^}]*)\}/g)].map((m) => m[1]).join(";");
    expect(chip).toContain("background: transparent");
    expect(chip).toContain("color-mix(in srgb, var(--chip-color) 60%, transparent)");
    expect(chip).toContain("height: var(--fs-control)");
    expect(chip).not.toContain("inset 3px");
  });

  it("labels its take-control button from the spec", () => {
    pin({ owner: "fc_mode", control_mode: "fc_manual" });
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    const action = screen.getByTestId("flight-state-chip").querySelector(".fs-chip-action")!;
    expect(action.textContent).toBe(specString("flow.take_control"));
  });
});
