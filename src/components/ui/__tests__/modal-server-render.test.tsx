// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Modal } from "../modal";

describe("Modal server render", () => {
  it("renders an open modal on the server without touching document", () => {
    expect(typeof document).toBe("undefined");
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
        <Modal open onClose={() => {}} title="Pair">
          body
        </Modal>
      </NextIntlClientProvider>,
    );
    expect(html).not.toContain("body");
  });
});
