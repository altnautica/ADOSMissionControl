/**
 * Keyboard behaviour where dialogs and the shared Select nest: Escape closes
 * only the top-most dialog (or only an open Select inside one), and a
 * searchable Select handles each key exactly once.
 */
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

const OPTIONS = ["a", "b", "c", "d", "e"].map((v) => ({ value: v, label: `Option ${v}` }));

function escape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

describe("stacked dialog keys", () => {
  it("Escape closes only the top-most of two stacked modals", () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    renderWithIntl(
      <Modal open onClose={onCloseOuter} title="Outer">
        <Modal open onClose={onCloseInner} title="Inner">
          <p>confirm</p>
        </Modal>
      </Modal>,
    );
    escape();
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it("Escape in an open Select closes the list, not the modal around it", () => {
    const onClose = vi.fn();
    function Form() {
      const [value, setValue] = useState("a");
      return (
        <Modal open onClose={onClose} title="Form">
          <Select options={OPTIONS} value={value} onChange={setValue} />
        </Modal>
      );
    }
    renderWithIntl(<Form />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // With the list closed, the next Escape reaches the modal.
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a searchable Select moves one option per arrow and selects once on Enter", () => {
    const onChange = vi.fn();
    renderWithIntl(<Select options={OPTIONS} value="a" onChange={onChange} searchable />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = screen.getByPlaceholderText("Search...");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
