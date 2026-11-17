/**
 * @license GPL-3.0-only
 *
 * The "Meet ADOS Pilot" step card follows the agent's own wizard: spec title
 * and the three body lines, the step state in the header, and the choice with
 * the recommended option first whatever order the engine lists it in.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => {
  const t = Object.assign((k: string) => k, { has: () => false });
  return { useTranslations: () => t };
});

import { StepCard } from "../StepCard";
import { setupText } from "@/lib/fc-setup/strings";
import type { SetupStep } from "@/lib/fc-setup/types";

const intro: SetupStep = {
  wizard: "ground",
  step: "ados_intro",
  title_key: "setup.ados_intro.title",
  body_key: "setup.ados_intro.body",
  args: { fallback_mode: "fc_manual" },
  inputs: [],
  image: null,
  state: "waiting_user",
  progress: null,
  live: {},
  // Listed secondary first: the card still leads with the recommended one.
  actions: [
    { id: "keep_fc", label_key: "setup.action.keep_fc", style: "secondary", confirm: "none" },
    { id: "use_ados", label_key: "setup.action.use_ados", style: "primary", confirm: "none" },
  ],
  blockers: [],
  result: null,
};

describe("StepCard: Meet ADOS Pilot", () => {
  it("shows the spec title, body lines and step state", () => {
    render(<StepCard step={intro} busy={false} error={null} onAction={() => {}} />);
    expect(screen.getByRole("heading").textContent).toBe(setupText("setup.ados_intro.title"));
    expect(screen.getByRole("heading").textContent).toBe("Meet ADOS Pilot");
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual(setupText("setup.ados_intro.body").split("\n"));
    expect(screen.getByText("stepState.waiting_user")).toBeTruthy();
  });

  it("puts the recommended option first, with spec texts", () => {
    const onAction = vi.fn();
    render(<StepCard step={intro} busy={false} error={null} onAction={onAction} />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual([setupText("setup.action.use_ados"), setupText("setup.action.keep_fc")]);
    expect(buttons[0]).toBe("Use ADOS Pilot (recommended)");
    fireEvent.click(screen.getByTestId("setup-action-use_ados"));
    expect(onAction).toHaveBeenCalledWith(intro, "use_ados", undefined);
  });
});

describe("StepCard: Meet ADOS Pilot with no RC receiver seen", () => {
  // The engine saw no RC receiver (`rc_present: false`), so the no-RC choice
  // leads, beside the two it always offers.
  const noRc: SetupStep = {
    ...intro,
    args: { fallback_mode: "fc_manual", rc_present: false },
    actions: [
      { id: "use_ados", label_key: "setup.action.use_ados", style: "secondary", confirm: "none" },
      { id: "keep_fc", label_key: "setup.action.keep_fc", style: "secondary", confirm: "none" },
      { id: "use_ados_no_rc", label_key: "setup.action.use_ados_no_rc", style: "primary", confirm: "none" },
    ],
  };

  it("offers use_ados_no_rc first, with its body line, and sends its id as use_ados is sent", () => {
    const onAction = vi.fn();
    render(<StepCard step={noRc} busy={false} error={null} onAction={onAction} />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual([
      "Use ADOS Pilot with no controller",
      setupText("setup.action.use_ados"),
      setupText("setup.action.keep_fc"),
    ]);
    expect(screen.getByTestId("setup-ados-intro-no-rc").textContent).toBe(setupText("setup.ados_intro.body.no_rc"));
    expect(screen.getByTestId("setup-ados-intro-no-rc").textContent).toMatch(/^This drone flies without an RC transmitter\./);
    fireEvent.click(screen.getByTestId("setup-action-use_ados_no_rc"));
    expect(onAction).toHaveBeenCalledWith(noRc, "use_ados_no_rc", undefined);
  });

  it("shows no no-RC line when the choice is not offered", () => {
    render(<StepCard step={intro} busy={false} error={null} onAction={() => {}} />);
    expect(screen.queryByTestId("setup-ados-intro-no-rc")).toBeNull();
  });
});
