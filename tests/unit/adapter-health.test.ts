/**
 * The radio adapter's two self-reported health readings, pinned end to end.
 *
 * Both readings exist because every counter above the adapter keeps moving
 * when the adapter is broken — a slow USB enumeration still accepts frames,
 * and a chipset that never entered monitor mode still has a name. So the cases
 * checked here are the ones where a surface could quietly claim health it was
 * never told about: an absent verdict, and a chipset string standing in for an
 * injection verdict. Each must resolve to the third state, and each phrase is
 * resolved against the real string catalogue so a missing key fails here
 * rather than rendering a raw key on screen.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";

import {
  resolveAdapterUsb,
  resolveAdapterInjection,
  adapterUsbLabel,
  adapterInjectionLabel,
} from "@/components/hardware/radio/adapter-health";
import messages from "../../locales/en.json";

// A real translator over the shipped catalogue, so interpolation is exercised
// and a missing key surfaces here. Cast to the loose hook-shaped parameter the
// label resolvers accept, matching the sibling label tests.
const t = createTranslator({
  locale: "en",
  messages,
  namespace: "hardware.radio",
}) as unknown as Parameters<typeof adapterUsbLabel>[0];

describe("resolveAdapterUsb", () => {
  it("reads a reported degraded link as an error, carrying the speed", () => {
    const r = resolveAdapterUsb({ degraded: true, speedMbps: 12 });
    expect(r.state).toBe("degraded");
    expect(r.speedMbps).toBe(12);
    expect(r.tone).toBe("error");
  });

  it("reads a reported healthy link as ok", () => {
    const r = resolveAdapterUsb({ degraded: false, speedMbps: 480 });
    expect(r.state).toBe("ok");
    expect(r.tone).toBe("success");
  });

  it("reads an absent verdict as unknown, never as ok", () => {
    for (const degraded of [null, undefined]) {
      const r = resolveAdapterUsb({ degraded, speedMbps: null });
      expect(r.state).toBe("unknown");
      expect(r.tone).toBe("muted");
      expect(r.tone).not.toBe("success");
    }
  });

  it("stays unknown when only a fast speed is reported", () => {
    // A high enumeration speed is not the adapter's verdict. Promoting it to
    // "ok" would present this app's guess as the adapter's own measurement.
    const r = resolveAdapterUsb({ degraded: null, speedMbps: 5000 });
    expect(r.state).toBe("unknown");
    expect(r.speedMbps).toBe(5000);
  });

  it("drops a non-finite speed rather than rendering it", () => {
    expect(
      resolveAdapterUsb({ degraded: true, speedMbps: Number.NaN }).speedMbps,
    ).toBeNull();
    expect(
      resolveAdapterUsb({ degraded: true, speedMbps: Infinity }).speedMbps,
    ).toBeNull();
  });
});

describe("resolveAdapterInjection", () => {
  it("reads a reported failure as an error", () => {
    const r = resolveAdapterInjection({
      injectionOk: false,
      chipset: "RTL8812EU",
    });
    expect(r.state).toBe("failed");
    expect(r.chipset).toBe("RTL8812EU");
    expect(r.tone).toBe("error");
  });

  it("reads a reported capability as ok", () => {
    const r = resolveAdapterInjection({ injectionOk: true, chipset: null });
    expect(r.state).toBe("ok");
    expect(r.tone).toBe("success");
  });

  it("reads an absent verdict as unknown even when a chipset is named", () => {
    // A chipset name proves a device was identified, never that it can
    // transmit. Nodes have reported a hardcoded true here before, so an
    // absent verdict is the honest reading, not a healthy one.
    const r = resolveAdapterInjection({
      injectionOk: null,
      chipset: "RTL8812EU",
    });
    expect(r.state).toBe("unknown");
    expect(r.tone).toBe("muted");
    expect(r.tone).not.toBe("success");
  });

  it("treats an empty chipset string as no chipset", () => {
    expect(
      resolveAdapterInjection({ injectionOk: true, chipset: "" }).chipset,
    ).toBeNull();
  });
});

describe("adapter health phrases", () => {
  it("names every USB state from the string catalogue", () => {
    const phrases = [
      adapterUsbLabel(t, resolveAdapterUsb({ degraded: true, speedMbps: 12 })),
      adapterUsbLabel(t, resolveAdapterUsb({ degraded: true, speedMbps: null })),
      adapterUsbLabel(t, resolveAdapterUsb({ degraded: false, speedMbps: 480 })),
      adapterUsbLabel(
        t,
        resolveAdapterUsb({ degraded: false, speedMbps: null }),
      ),
      adapterUsbLabel(t, resolveAdapterUsb({ degraded: null, speedMbps: null })),
    ];
    for (const phrase of phrases) {
      expect(phrase).toBeTruthy();
      // next-intl echoes the key path when a message is missing.
      expect(phrase).not.toContain("adapterUsb.");
    }
    expect(phrases[0]).toContain("12");
    expect(phrases[2]).toContain("480");
  });

  it("names every injection state from the string catalogue", () => {
    const phrases = [
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: false, chipset: "RTL8812EU" }),
      ),
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: false, chipset: null }),
      ),
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: true, chipset: "RTL8812EU" }),
      ),
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: true, chipset: null }),
      ),
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: null, chipset: "RTL8812EU" }),
      ),
      adapterInjectionLabel(
        t,
        resolveAdapterInjection({ injectionOk: null, chipset: null }),
      ),
    ];
    for (const phrase of phrases) {
      expect(phrase).toBeTruthy();
      expect(phrase).not.toContain("adapterInjection.");
    }
    expect(phrases[0]).toContain("RTL8812EU");
  });

  it("does not phrase an unknown reading as ok", () => {
    const unknownUsb = adapterUsbLabel(
      t,
      resolveAdapterUsb({ degraded: null, speedMbps: 480 }),
    );
    const okUsb = adapterUsbLabel(
      t,
      resolveAdapterUsb({ degraded: false, speedMbps: 480 }),
    );
    expect(unknownUsb).not.toBe(okUsb);

    const unknownInjection = adapterInjectionLabel(
      t,
      resolveAdapterInjection({ injectionOk: null, chipset: "RTL8812EU" }),
    );
    const okInjection = adapterInjectionLabel(
      t,
      resolveAdapterInjection({ injectionOk: true, chipset: "RTL8812EU" }),
    );
    expect(unknownInjection).not.toBe(okInjection);
  });
});
