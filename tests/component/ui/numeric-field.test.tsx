/**
 * NumericField keeps partial input as a draft: a negative value can be typed,
 * an emptied or out-of-range field reverts instead of committing 0, and a
 * source change replaces the draft.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NumericField } from "@/components/ui/numeric-field";

afterEach(cleanup);

function field(value: number | undefined, onCommit = vi.fn()) {
  const utils = render(<NumericField label="Lat" value={value} min={-90} max={90} onCommit={onCommit} />);
  return { input: screen.getByLabelText("Lat") as HTMLInputElement, onCommit, ...utils };
}

describe("NumericField", () => {
  it("commits a typed negative value on blur, never 0 on the way", () => {
    const { input, onCommit } = field(12.5);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "-33.8568" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-33.8568);
  });

  it("reverts an emptied field instead of committing 0", () => {
    const { input, onCommit } = field(12.5);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("12.5");
  });

  it("reverts an out-of-range value", () => {
    const { input, onCommit } = field(12.5);
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("12.5");
  });

  it("follows a source change and does not write the old draft back", () => {
    const onCommit = vi.fn();
    const { input, rerender } = field(12.5, onCommit);
    rerender(<NumericField label="Lat" value={-10} min={-90} max={90} onCommit={onCommit} />);
    expect(input.value).toBe("-10");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
