/**
 * @module ui/bitmask-editor.test
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${JSON.stringify(values)})` : key,
}));

import { BitmaskEditor } from "../bitmask-editor";

const bm = new Map<number, string>([
  [0, "Double notch"],
  [1, "Dynamic harmonic"],
  [2, "Update at loop rate"],
  [3, "EnableOnAllIMUs"],
]);

function renderEditor(value: number, onApply = vi.fn(), onClose = vi.fn(), bitmask = bm) {
  render(
    <BitmaskEditor open title="Set Bitmask" bitmask={bitmask} value={value} onApply={onApply} onClose={onClose} />,
  );
  return { onApply, onClose };
}

describe("BitmaskEditor", () => {
  it("renders one checkbox per documented bit with the right checked state", () => {
    renderEditor(5); // bits 0 + 2
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect(boxes[2].checked).toBe(true);
    expect(boxes[3].checked).toBe(false);
  });

  it("toggles a bit and commits the new value on Apply", () => {
    const { onApply } = renderEditor(5);
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // set bit 1 → 7
    fireEvent.click(screen.getByText("apply"));
    expect(onApply).toHaveBeenCalledWith(7);
  });

  it("preserves undocumented bits when toggling a documented one", () => {
    const value = 5 | (1 << 20);
    const { onApply } = renderEditor(value);
    // An "unknown" row for bit 20 is shown (distinct from the unknownBitsKept note).
    expect(screen.getByText(/unknownBit\(/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]); // clear bit 0
    fireEvent.click(screen.getByText("apply"));
    const emitted = onApply.mock.calls[0][0] as number;
    expect(emitted & (1 << 20)).not.toBe(0); // bit 20 survived
    expect(emitted & 1).toBe(0); // bit 0 cleared
  });

  it("Select all sets every documented bit", () => {
    const { onApply } = renderEditor(0);
    fireEvent.click(screen.getByText("selectAll"));
    fireEvent.click(screen.getByText("apply"));
    expect(onApply).toHaveBeenCalledWith(15);
  });

  it("Clear all clears documented bits but preserves unknown bits", () => {
    const value = (1 << 20) | 1;
    const single = new Map<number, string>([[0, "A"]]);
    const { onApply } = renderEditor(value, vi.fn(), vi.fn(), single);
    fireEvent.click(screen.getByText("clearAll"));
    fireEvent.click(screen.getByText("apply"));
    expect(onApply).toHaveBeenCalledWith(1 << 20);
  });

  it("Cancel discards without committing", () => {
    const { onApply, onClose } = renderEditor(5);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByText("cancel"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("accepts a typed 0x hex value and commits it on Apply", () => {
    const { onApply } = renderEditor(5);
    const raw = screen.getByLabelText("rawValue") as HTMLInputElement;
    // Type it the way an operator does: the "0x" prefix is not a number yet.
    for (const text of ["0", "0x", "0x1", "0x1F"]) fireEvent.change(raw, { target: { value: text } });
    expect(raw.value).toBe("0x1F");
    fireEvent.click(screen.getByText("apply"));
    expect(onApply).toHaveBeenCalledWith(0x1f);
  });

  it("lets the field be cleared and refuses to apply a partial number", () => {
    const { onApply } = renderEditor(5);
    const raw = screen.getByLabelText("rawValue") as HTMLInputElement;
    fireEvent.change(raw, { target: { value: "" } });
    expect(raw.value).toBe("");
    fireEvent.change(raw, { target: { value: "12abc" } });
    fireEvent.blur(raw);
    expect(screen.getByRole("alert").textContent).toBe("bitmaskRawInvalid");
    fireEvent.keyDown(raw, { key: "Enter" });
    fireEvent.click(screen.getByText("apply"));
    expect(onApply).not.toHaveBeenCalled();
  });
});
