import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { Modal } from "../modal";

function Page() {
  return (
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      <main>
        <Modal open onClose={() => {}} title="Pair">
          <button type="button">Approve</button>
        </Modal>
      </main>
    </NextIntlClientProvider>
  );
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Modal open on first load", () => {
  it("moves focus into the dialog once hydration shows it", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Page />);
    document.body.appendChild(host);
    await act(async () => {
      root = hydrateRoot(host, <Page />);
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
