/**
 * Tests for the skill confirm host + store. Verifies the confirm seam resolves
 * the dispatcher's promise on confirm and cancel, that the checklist-aware
 * OVERRIDE escalation engages when the pre-flight checklist is incomplete, and
 * that a two-stage (Kill) policy gates the final confirm behind a countdown.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import { SkillConfirmHost } from "@/components/cockpit/SkillConfirmHost";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useChecklistStore } from "@/stores/checklist-store";
import type { ConfirmPolicy } from "@/lib/skills/types";

function resetStores() {
  useSkillConfirmStore.setState({ pending: null, _nextId: 1 });
  // Mark every checklist item ready for drone-1 so the default path is the
  // non-escalated confirm; individual tests override.
  useChecklistStore.setState((s) => ({
    droneId: "drone-1",
    items: s.items.map((item) => ({ ...item, status: "skipped" as const })),
  }));
}

const ARM_POLICY: ConfirmPolicy = {
  title: "skills.arm.confirm.title",
  message: "skills.arm.confirm.message",
  confirmLabel: "skills.arm.confirm.button",
  variant: "danger",
  typedPhrase: "ARM",
  checklistAware: true,
};

const KILL_POLICY: ConfirmPolicy = {
  title: "skills.kill.confirm.title",
  message: "skills.kill.confirm.message",
  confirmLabel: "skills.kill.confirm.button",
  variant: "danger",
  typedPhrase: "KILL",
  twoStageCountdownSeconds: 3,
};

describe("SkillConfirmHost", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no pending confirm", () => {
    const { container } = renderWithIntl(<SkillConfirmHost />);
    expect(container.textContent).toBe("");
  });

  it("resolves true after the typed phrase is entered and confirmed", async () => {
    renderWithIntl(<SkillConfirmHost />);

    let resolved: boolean | null = null;
    act(() => {
      void useSkillConfirmStore
        .getState()
        .request(ARM_POLICY, "drone-1")
        .then((v) => {
          resolved = v;
        });
    });

    // The typed-phrase gate keeps confirm disabled until "ARM" is typed.
    const input = await screen.findByLabelText(/type/i);
    fireEvent.change(input, { target: { value: "ARM" } });

    const confirmButton = screen.getByRole("button", { name: /^Arm$/ });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(resolved).toBe(true));
    expect(useSkillConfirmStore.getState().pending).toBeNull();
  });

  it("resolves false on cancel", async () => {
    renderWithIntl(<SkillConfirmHost />);

    let resolved: boolean | null = null;
    act(() => {
      void useSkillConfirmStore
        .getState()
        .request(ARM_POLICY, "drone-1")
        .then((v) => {
          resolved = v;
        });
    });

    const cancel = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);

    await waitFor(() => expect(resolved).toBe(false));
    expect(useSkillConfirmStore.getState().pending).toBeNull();
  });

  it("escalates to OVERRIDE when the checklist is incomplete", async () => {
    // Force one checklist item to fail so the checklist is not ready.
    useChecklistStore.setState((s) => ({
      items: s.items.map((item, i) =>
        i === 0 ? { ...item, status: "pending" as const } : item,
      ),
    }));

    renderWithIntl(<SkillConfirmHost />);
    act(() => {
      void useSkillConfirmStore.getState().request(ARM_POLICY, "drone-1");
    });

    // The OVERRIDE phrase is required, not the normal ARM phrase.
    const input = await screen.findByLabelText(/type/i);
    expect(screen.getByText("OVERRIDE")).toBeTruthy();
    fireEvent.change(input, { target: { value: "OVERRIDE" } });
    expect(
      (screen.getByRole("button", { name: /^Arm$/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("escalates to OVERRIDE when the checklist was completed for another drone", async () => {
    renderWithIntl(<SkillConfirmHost />);
    act(() => {
      void useSkillConfirmStore.getState().request(ARM_POLICY, "drone-2");
    });

    await screen.findByLabelText(/type/i);
    expect(screen.getByText("OVERRIDE")).toBeTruthy();
  });

  it("gates the two-stage kill confirm behind a countdown", async () => {
    vi.useFakeTimers();
    try {
      renderWithIntl(<SkillConfirmHost />);

      let resolved: boolean | null = null;
      act(() => {
        void useSkillConfirmStore
          .getState()
          .request(KILL_POLICY)
          .then((v) => {
            resolved = v;
          });
      });

      // First stage: confirm advances to the final dialog.
      const firstConfirm = screen.getByRole("button", {
        name: /I understand/i,
      });
      act(() => {
        fireEvent.click(firstConfirm);
      });

      // The final-stage confirm is disabled while the countdown runs.
      const waiting = screen.getByRole("button", { name: /Wait/i });
      expect((waiting as HTMLButtonElement).disabled).toBe(true);

      // Run the 3-second countdown one tick at a time so each re-render
      // schedules the next timer.
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(1000);
        });
      }

      const finalConfirm = screen.getByRole("button", {
        name: /KILL MOTORS NOW/i,
      });
      expect((finalConfirm as HTMLButtonElement).disabled).toBe(true); // typed-phrase still gates

      // Enter the KILL phrase, then confirm.
      const input = screen.getByLabelText(/type/i);
      fireEvent.change(input, { target: { value: "KILL" } });
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /KILL MOTORS NOW/i }));
      });

      // The resolve runs synchronously; flush the .then microtask.
      await act(async () => {
        await Promise.resolve();
      });
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
