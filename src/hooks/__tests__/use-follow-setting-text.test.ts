import { describe, expect, it } from "vitest";

import { notAppliedText } from "@/hooks/use-follow-setting";

describe("follow setting not-applied toast", () => {
  it("names each setting that was not applied, never a bare Failed", () => {
    expect(notAppliedText("reacquire_mode")).toBe("Re-acquire mode not applied");
    expect(notAppliedText("uncertain_mode")).toBe("When-unsure setting not applied");
    expect(notAppliedText("predictive_search")).toBe("Predictive search not applied");
  });
});
