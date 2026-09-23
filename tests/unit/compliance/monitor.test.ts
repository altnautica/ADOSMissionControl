/**
 * Expiry alerts treat a document as valid through its whole expiry day, in
 * the operator's local calendar.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { runComplianceChecks } from "@/lib/compliance/monitor";

function licenceAlerts(expiry: string) {
  return runComplianceChecks({ pilotLicenseExpiry: expiry }, {}, {}, {}).filter((a) => a.category === "pilot_license");
}

describe("compliance expiry alerts", () => {
  afterEach(() => vi.useRealTimers());

  it("reads a licence as still valid late on its expiry day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 23, 30));
    const [alert] = licenceAlerts("2026-09-23");
    expect(alert).toMatchObject({ id: "pilot-license-expiring", severity: "error" });
    expect(alert.message).toContain("expires today");
  });

  it("reads it as expired from the next day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 24, 0, 30));
    const [alert] = licenceAlerts("2026-09-23");
    expect(alert).toMatchObject({ id: "pilot-license-expired" });
    expect(alert.message).toContain("expired 1 day ago");
  });

  it("counts whole days left early on a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 13, 0, 5));
    expect(licenceAlerts("2026-09-23")[0].message).toContain("expires in 10 days");
  });
});
