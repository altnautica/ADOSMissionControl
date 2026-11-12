/**
 * @module ui/toast-dismiss.test
 * @description The toast dismiss button carries a padded hit area (32 px, 48 px
 * on a coarse pointer) around its 12 px glyph.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { ToastProvider, useToast } from "../toast";

function Fire({ status }: { status: "info" | "error" }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast("Battery low", status)}>
      fire-{status}
    </button>
  );
}

afterEach(cleanup);

describe("toast dismiss hit area", () => {
  it.each(["info", "error"] as const)("pads the %s dismiss button", (status) => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ToastProvider>
          <Fire status={status} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    act(() => screen.getByText(`fire-${status}`).click());
    const label =
      status === "info" ? messages.toast.dismiss : messages.toast.dismissError;
    const cls = screen.getByRole("button", { name: label }).className;
    expect(cls).toContain("p-2.5");
    expect(cls).toContain("-m-2.5");
    expect(cls).toContain("pointer-coarse:p-[18px]");
  });
});
