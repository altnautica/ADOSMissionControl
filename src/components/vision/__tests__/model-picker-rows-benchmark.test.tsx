import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { ModelPickerRows } from "@/components/vision/ModelPickerRows";
import type { FilteredModel } from "@/lib/vision/model-filter";

function row(id: string, benchmarkOnly: boolean): FilteredModel {
  return {
    id,
    name: id,
    description: "",
    task: "reid",
    sources: ["registry"],
    installed: false,
    custom: false,
    active: false,
    fits: true,
    fitReason: null,
    customMeta: null,
    benchmarkOnly,
  };
}

function renderRows(models: FilteredModel[]) {
  render(
    <ModelPickerRows
      models={models}
      mode="full"
      downloads={{}}
      settingActive={null}
      isHardBlocked={false}
      hardBlockMessage=""
      startDownload={() => {}}
      setActive={() => {}}
    />,
  );
}

describe("ModelPickerRows benchmark-only badge", () => {
  afterEach(cleanup);

  it("badges a benchmark-only model with its explanation", () => {
    renderRows([row("osnet", true)]);
    const badge = screen.getByText("benchmarkOnly");
    expect(badge.closest("[title]")?.getAttribute("title")).toBe("benchmarkOnlyHint");
  });

  it("shows no badge on an ordinary model", () => {
    renderRows([row("yolox", false)]);
    expect(screen.queryByText("benchmarkOnly")).toBeNull();
  });
});
