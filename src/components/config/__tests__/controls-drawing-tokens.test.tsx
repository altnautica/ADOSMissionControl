/**
 * @license GPL-3.0-only
 *
 * Settings › Controls draws the controller in the cockpit spec's controller
 * colours (tokens.json `controller`): a pressed control, the stick dots and
 * the trigger bars fill with `pressed`, the deadzone ring strokes with
 * `deadzone_ring`; no hex is hard-coded in the drawing.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { useInputStore } from "@/stores/input-store";
import { ControlsSettings } from "../ControlsSettings";

afterEach(cleanup);

describe("controller drawing colours", () => {
  it("fills the stick dots with the pressed token and rings the deadzone with its token", () => {
    renderWithIntl(<ControlsSettings />);
    const dot = screen.getByTestId("stick_l-dot");
    expect(dot.getAttribute("fill")).toBe(tokens.controller.pressed);
    const ring = dot.previousElementSibling as SVGElement;
    expect(ring.getAttribute("stroke")).toBe(tokens.controller.deadzone_ring);
  });

  it("fills a pressed control with the pressed token", () => {
    const buttons = Array.from({ length: 17 }, () => false);
    buttons[0] = true;
    useInputStore.setState({ buttons } as never);
    renderWithIntl(<ControlsSettings />);
    const pressed = document.querySelector("[data-pressed='true']");
    expect(pressed?.getAttribute("fill")).toBe(tokens.controller.pressed);
    useInputStore.setState({ buttons: [] } as never);
  });

  it("hard-codes no colour hex in the drawing", () => {
    const src = readFileSync("src/components/config/ControlsSettings.tsx", "utf8");
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });
});
