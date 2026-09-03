/**
 * Behavioural cover for the shared dialog affordances: role, Escape handling,
 * focus entry, focus restore, the Tab focus trap, initial-focus pinning and the
 * labelled close control. Every hand-rolled dialog migrated onto `Modal`
 * inherits these, so they are asserted once here rather than per dialog.
 *
 * `ArmedWriteConfirmDialog` gets its own case because it is the one dialog
 * where initial focus is load-bearing: it confirms a parameter write to an
 * armed vehicle, and focus must land on Cancel so a keyboard activation cannot
 * commit the write.
 */
import { useRef, useState, type ReactNode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ArmedWriteConfirmDialog } from "@/components/indicators/ArmedWriteConfirmDialog";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";

const TITLE = "Pending write";

/** Two body actions, so the trap has a first and a last focusable to wrap between. */
function TwoActions() {
  return (
    <>
      <button type="button">first action</button>
      <button type="button">second action</button>
    </>
  );
}

/** A trigger outside the dialog, so focus has somewhere to be restored to. */
function TriggerAndModal({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open dialog
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={TITLE}>
        {children}
      </Modal>
    </>
  );
}

function keydown(key: string, init: { shiftKey?: boolean } = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

describe("dialog accessibility affordances", () => {
  it("announces as a dialog by default and as an alertdialog on request", () => {
    const { unmount } = renderWithIntl(
      <Modal open onClose={vi.fn()} title={TITLE}>
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    unmount();

    renderWithIntl(
      <Modal open onClose={vi.fn()} title={TITLE} role="alertdialog">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole("alertdialog", { name: TITLE })).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("closes on Escape, and does not while closing is blocked", () => {
    const onClose = vi.fn();
    const { unmount } = renderWithIntl(
      <Modal open onClose={onClose} title={TITLE}>
        <p>body</p>
      </Modal>,
    );
    keydown("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const blocked = vi.fn();
    renderWithIntl(
      <Modal open onClose={blocked} title={TITLE} closeBlocked>
        <p>body</p>
      </Modal>,
    );
    keydown("Escape");
    expect(blocked).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open and restores it on close", () => {
    renderWithIntl(
      <TriggerAndModal>
        <TwoActions />
      </TriggerAndModal>,
    );

    const trigger = screen.getByRole("button", { name: "open dialog" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab inside the dialog, wrapping at both ends", () => {
    renderWithIntl(
      <Modal open onClose={vi.fn()} title={TITLE}>
        <TwoActions />
      </Modal>,
    );

    // DOM order of focusables: close, first action, second action.
    const close = screen.getByRole("button", { name: /close/i });
    const last = screen.getByRole("button", { name: "second action" });

    last.focus();
    keydown("Tab");
    expect(document.activeElement).toBe(close);

    close.focus();
    keydown("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("honours initialFocusRef over the first focusable element", () => {
    function PinnedFocus() {
      const secondRef = useRef<HTMLButtonElement>(null);
      return (
        <Modal
          open
          onClose={vi.fn()}
          title={TITLE}
          initialFocusRef={secondRef}
        >
          <Button>first action</Button>
          <Button ref={secondRef}>second action</Button>
        </Modal>
      );
    }
    renderWithIntl(<PinnedFocus />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "second action" }),
    );
  });

  it("gives the close control a non-empty accessible name", () => {
    renderWithIntl(
      <Modal open onClose={vi.fn()} title={TITLE}>
        <p>body</p>
      </Modal>,
    );

    const close = screen.getByRole("button", { name: /close/i });
    expect(close).toHaveAccessibleName();
  });
});

describe("ArmedWriteConfirmDialog", () => {
  beforeEach(() => {
    useArmedConfirmStore.setState({ open: false, context: null, _resolve: null });
  });

  it("opens with focus on Cancel, so a keyboard activation cannot commit the write", () => {
    // `_resolve` is the promise settler behind requestConfirm(): confirm()
    // calls it with true, cancel() with false.
    const resolve = vi.fn();
    useArmedConfirmStore.setState({
      open: true,
      context: { panelId: "params", paramNames: ["FS_THR_ENABLE"] },
      _resolve: resolve,
    });

    renderWithIntl(<ArmedWriteConfirmDialog />);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);

    // happy-dom does not synthesise the implicit activation a browser performs
    // when Enter is pressed on a focused button, so drive both halves: the key
    // event, then the activation it would produce on the focused element.
    const focused = document.activeElement as HTMLElement;
    keydown("Enter");
    act(() => focused.click());

    expect(resolve).not.toHaveBeenCalledWith(true);
    expect(useArmedConfirmStore.getState().open).toBe(false);
  });
});
