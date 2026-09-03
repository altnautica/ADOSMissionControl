/**
 * @module ui/library-a11y.test
 * @description The shared UI library had no keyboard story at all.
 *
 * A survey of `src/components/ui/` found zero `focus-visible` styles across
 * all 24 components, a clickable `Card` that was a bare `<div onClick>`, a
 * `Tabs` strip with no `role`/`aria-selected`/arrow keys, `Table` sorting on a
 * `<th onClick>`, a `Toggle` switch with no accessible name, an `Input` whose
 * error text was associated with nothing, and a `ProgressBar` that conveyed
 * its whole meaning through width and colour. Every assertion here is one of
 * those defects, expressed as the operator consequence: a control that cannot
 * be reached or read without a pointer.
 *
 * @license GPL-3.0-only
 */

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { Button } from "../button";
import { Card } from "../card";
import { Input } from "../input";
import { ProgressBar } from "../progress-bar";
import { Table } from "../table";
import { Tabs } from "../tabs";
import { Toggle } from "../toggle";

describe("Button", () => {
  it("defaults to type=button so it cannot submit a surrounding form", () => {
    // Every Button placed inside a <form> used to submit it, because a bare
    // <button> defaults to type=submit.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithIntl(
      <form onSubmit={onSubmit}>
        <Button>Save to RAM</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save to RAM" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still lets a caller opt into submit explicitly", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithIntl(
      <form onSubmit={onSubmit}>
        <Button type="submit">Connect</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("paints the primary variant with the theme-aware accent foreground", () => {
    // Not `text-white`: white failed WCAG AA on 18 of the 22 palettes.
    // See tests/unit/theme-contrast.test.ts for the measurement.
    renderWithIntl(<Button>Arm</Button>);
    const cls = screen.getByRole("button", { name: "Arm" }).className;
    expect(cls).toContain("text-accent-foreground");
    expect(cls).not.toContain("text-white");
    expect(cls).toContain("focus-ring");
  });
});

describe("Card", () => {
  it("makes a clickable card reachable and activatable by keyboard", () => {
    // Was a bare <div onClick>: not focusable, not in the tab order, inert to
    // Enter and Space, so a card-as-navigation surface needed a mouse.
    const onClick = vi.fn();
    renderWithIntl(
      <Card title="Radio" onClick={onClick}>
        body
      </Card>,
    );
    const card = screen.getByRole("button", { name: "Radio" });
    expect(card.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("leaves a presentational card as plain markup", () => {
    // A non-interactive card must NOT claim a button role or a tab stop.
    renderWithIntl(<Card title="Averages">body</Card>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Tabs", () => {
  const TABS = [
    { id: "raw", label: "Raw frames" },
    { id: "decoded", label: "Decoded transfers" },
  ];

  it("exposes the ARIA tabs pattern with a roving tabindex", () => {
    renderWithIntl(
      <Tabs tabs={TABS} activeTab="raw" onChange={vi.fn()} label="Bus monitor" />,
    );
    expect(screen.getByRole("tablist", { name: "Bus monitor" })).toBeTruthy();
    const [raw, decoded] = screen.getAllByRole("tab");
    expect(raw!.getAttribute("aria-selected")).toBe("true");
    expect(decoded!.getAttribute("aria-selected")).toBe("false");
    // One tab stop for the whole strip, per the ARIA tabs pattern.
    expect(raw!.getAttribute("tabindex")).toBe("0");
    expect(decoded!.getAttribute("tabindex")).toBe("-1");
  });

  it("walks the strip with the arrow keys and wraps", () => {
    // Without this a keyboard operator had to Tab through every leg, and the
    // strip announced as an unrelated run of buttons.
    const onChange = vi.fn();
    renderWithIntl(
      <Tabs tabs={TABS} activeTab="raw" onChange={onChange} label="Bus monitor" />,
    );
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("decoded");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("decoded"); // wraps from index 0
    fireEvent.keyDown(list, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("decoded");
    fireEvent.keyDown(list, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("raw");
  });

  it("associates a tab with its panel when given a panelId", () => {
    renderWithIntl(
      <Tabs
        tabs={[{ id: "raw", label: "Raw frames", panelId: "panel-raw" }]}
        activeTab="raw"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("tab").getAttribute("aria-controls"),
    ).toBe("panel-raw");
  });
});

describe("Table", () => {
  const COLUMNS = [
    { key: "name", label: "Node", sortable: true },
    { key: "hz", label: "Rate" },
  ];
  const DATA = [
    { name: "beta", hz: 2 },
    { name: "alpha", hz: 1 },
  ];

  it("sorts from the keyboard and announces the sort direction", () => {
    // Sorting lived on <th onClick>: not focusable and inert to the keyboard,
    // so ordering a table was pointer-only, and the chevron was the only
    // channel telling anyone which column was active.
    renderWithIntl(<Table columns={COLUMNS} data={DATA} />);
    const header = screen.getByRole("columnheader", { name: /Node/ });
    expect(header.getAttribute("aria-sort")).toBe("none");

    const sortButton = screen.getByRole("button", { name: /Node/ });
    fireEvent.click(sortButton);
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(sortButton);
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("gives a non-sortable column no button and no aria-sort", () => {
    renderWithIntl(<Table columns={COLUMNS} data={DATA} />);
    const plain = screen.getByRole("columnheader", { name: /Rate/ });
    expect(plain.hasAttribute("aria-sort")).toBe(false);
    expect(screen.queryByRole("button", { name: /Rate/ })).toBeNull();
  });

  it("makes a clickable row reachable by keyboard", () => {
    const onRowClick = vi.fn();
    renderWithIntl(
      <Table
        columns={COLUMNS}
        data={DATA}
        onRowClick={onRowClick}
        rowKey={(r) => String(r.name)}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows[0]!.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

describe("Toggle", () => {
  it("names the switch and keeps the thumb visible in both states", () => {
    // The visible label was a sibling <span>, not the button's content, so the
    // switch had no reliable accessible name. The thumb was a fixed
    // `bg-white`, invisible against `bg-bg-tertiary` on the light themes when
    // the switch was OFF — the operator could not see the state.
    const onChange = vi.fn();
    const { rerender } = renderWithIntl(
      <Toggle label="Auto-dim after 60 s idle" checked={false} onChange={onChange} />,
    );
    const control = screen.getByRole("switch", {
      name: "Auto-dim after 60 s idle",
    });
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.className).toContain("focus-ring");
    expect(control.querySelector("span")!.className).not.toContain("bg-white");

    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Toggle label="Auto-dim after 60 s idle" checked onChange={onChange} />,
    );
    expect(
      screen.getByRole("switch").getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("Input", () => {
  it("associates its error text so a rejected write is announced", () => {
    // The error was a loose <span> tied to nothing: a screen reader read the
    // field as valid and never said why the value was refused.
    renderWithIntl(<Input label="Max Altitude" error="Above fence ceiling" />);
    const field = screen.getByLabelText("Max Altitude");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)!.textContent).toBe(
      "Above fence ceiling",
    );
  });

  it("claims neither attribute when the value is valid", () => {
    renderWithIntl(<Input label="Max Altitude" />);
    const field = screen.getByLabelText("Max Altitude");
    expect(field.hasAttribute("aria-invalid")).toBe(false);
    expect(field.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("ProgressBar", () => {
  it("reports its value as text, not only as width and colour", () => {
    renderWithIntl(<ProgressBar value={42} label="Disk" />);
    const bar = screen.getByRole("progressbar", { name: "Disk" });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuetext")).toBe("42%");
  });

  it("clamps an out-of-range reading rather than reporting it", () => {
    renderWithIntl(<ProgressBar value={140} label="Disk" />);
    expect(
      screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    ).toBe("100");
  });
});
