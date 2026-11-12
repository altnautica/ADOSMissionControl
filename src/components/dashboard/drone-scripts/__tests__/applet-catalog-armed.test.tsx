/**
 * Adding an applet with tunables asks the armed-write confirmation first, and
 * a declined confirmation sends nothing to the flight controller.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../locales/en.json";

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  protocol: {
    uploadFileViaFtp: vi.fn(async () => undefined),
    getParameter: vi.fn(async () => ({ value: 1 })),
    setParameter: vi.fn(async () => ({ success: true })),
    commitParamsToFlash: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock("@/lib/protocol/param-write", () => ({ confirmArmedParamWrite: h.confirm }));
vi.mock("@/stores/drone-manager", () => ({
  selectSelectedProtocol: () => h.protocol,
  useDroneManager: (sel: (s: unknown) => unknown) => sel({}),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { AppletCatalog } from "../AppletCatalog";
import { APPLET_CATALOG } from "../applet-catalog";

async function addFirstAppletWithParams() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AppletCatalog />
    </NextIntlClientProvider>,
  );
  const index = APPLET_CATALOG.findIndex((e) => e.params?.length);
  const button = screen.getAllByRole("button", { name: "Add" })[index];
  await act(async () => fireEvent.click(button));
  return APPLET_CATALOG[index];
}

beforeEach(() => {
  h.confirm.mockReset();
  for (const fn of Object.values(h.protocol)) fn.mockClear();
});

describe("AppletCatalog armed writes", () => {
  it("sends nothing when the operator declines the armed confirmation", async () => {
    h.confirm.mockResolvedValue(false);
    const entry = await addFirstAppletWithParams();
    expect(h.confirm).toHaveBeenCalledWith(expect.any(String), entry.params!.map((p) => p.name));
    expect(h.protocol.uploadFileViaFtp).not.toHaveBeenCalled();
    expect(h.protocol.setParameter).not.toHaveBeenCalled();
  });

  it("writes the tunables once confirmed", async () => {
    h.confirm.mockResolvedValue(true);
    await addFirstAppletWithParams();
    expect(h.protocol.setParameter).toHaveBeenCalled();
  });
});
