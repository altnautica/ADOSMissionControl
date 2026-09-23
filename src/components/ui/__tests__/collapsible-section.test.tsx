/**
 * CollapsibleSection keyboard behaviour: a button in the trailing slot keeps
 * its own Enter/Space (the key must not be swallowed or toggle the section),
 * while the header itself toggles from the keyboard.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CollapsibleSection } from "../collapsible-section";

afterEach(cleanup);

function renderSection(onAdd = vi.fn()) {
  render(
    <CollapsibleSection
      title="Waypoints"
      defaultOpen
      trailing={<button type="button" onClick={onAdd}>Add waypoint</button>}
    >
      <p>body</p>
    </CollapsibleSection>,
  );
  return { onAdd, header: screen.getByRole("button", { name: /waypoints/i }) };
}

describe("CollapsibleSection", () => {
  it("leaves Enter and Space on a trailing button to that button", () => {
    const { header } = renderSection();
    const add = screen.getByRole("button", { name: "Add waypoint" });
    for (const key of ["Enter", " "]) {
      // fireEvent returns false when a handler called preventDefault, which is
      // what stops the browser from turning the key into the button's click.
      expect(fireEvent.keyDown(add, { key })).toBe(true);
    }
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not nest the trailing button inside the toggle", () => {
    const { header } = renderSection();
    const add = screen.getByRole("button", { name: "Add waypoint" });
    expect(header.contains(add)).toBe(false);
  });

  it("toggles from the header and runs the trailing action on its own click", () => {
    const { header, onAdd } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add waypoint" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });
});
