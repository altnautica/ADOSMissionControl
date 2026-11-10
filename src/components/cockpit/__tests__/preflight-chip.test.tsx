import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreflightChip } from "@/components/cockpit/PreflightChip";
import { checklistReadyFor, useChecklistStore } from "@/stores/checklist-store";
import type { PreflightItem } from "@/lib/cockpit/preflight";

const PASS: PreflightItem = { id: "link", label: "Link", state: "pass" };
const WARN: PreflightItem = { id: "storage", label: "On-board storage (not reported)", state: "warn" };
const FAIL: PreflightItem = { id: "fc_prearm", label: "Flight controller: GPS not healthy", state: "fail" };

function open() {
  render(
    <div className="ados-cockpit">
      <PreflightChip droneId="d1" />
    </div>,
  );
  fireEvent.click(screen.getByTitle("Pre-flight checklist"));
}

beforeEach(() => {
  useChecklistStore.setState({ droneId: "d1", preflight: null, completedAt: null });
});
afterEach(cleanup);

describe("pre-flight chip", () => {
  it("lists the spec checklist items, not the old manual checklist", () => {
    useChecklistStore.setState({ preflight: [PASS, WARN] });
    open();
    const items = screen.getByTestId("preflight-items");
    expect([...items.querySelectorAll("li")].map((li) => li.textContent)).toEqual([PASS.label, WARN.label]);
    expect(screen.getByTestId("cockpit-preflight").textContent).toContain("2/2");
  });

  it("keeps Checks done disabled and asks to fix while an item fails", () => {
    useChecklistStore.setState({ preflight: [PASS, FAIL] });
    open();
    const done = screen.getByTestId("preflight-done") as HTMLButtonElement;
    expect(done.textContent).toBe("Fix the failing checks");
    expect(done.disabled).toBe(true);
  });

  it("passes the first-arm gate with Checks done once no item fails", () => {
    useChecklistStore.setState({ preflight: [PASS, WARN] });
    open();
    const done = screen.getByTestId("preflight-done");
    expect(done.textContent).toBe("Checks done");
    fireEvent.click(done);
    expect(checklistReadyFor(useChecklistStore.getState(), "d1")).toBe(true);
  });

  it("shows no data for a checklist evaluated for another drone", () => {
    useChecklistStore.setState({ droneId: "other", preflight: [PASS] });
    open();
    expect(screen.getByTestId("preflight-items").children).toHaveLength(0);
    expect((screen.getByTestId("preflight-done") as HTMLButtonElement).disabled).toBe(true);
  });
});
