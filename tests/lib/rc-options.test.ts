/**
 * The RCx_OPTION label table must not name any value other than 31 as the
 * motor emergency stop: an operator picking "E-Stop" from a wrong row gets a
 * switch that does something else (41 is the pre-4.2 arm/disarm switch).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { RC_OPTION_MAP } from "@/lib/rc-options";

describe("RC_OPTION_MAP safety switches", () => {
  it("labels 31/32/33 as E-Stop, Motor Interlock and Brake", () => {
    expect(RC_OPTION_MAP.get(31)).toBe("Motor E-Stop");
    expect(RC_OPTION_MAP.get(32)).toBe("Motor Interlock");
    expect(RC_OPTION_MAP.get(33)).toBe("Brake");
  });

  it("names only 31 as a motor emergency stop", () => {
    const stops = [...RC_OPTION_MAP].filter(([, label]) => /e-stop|emergency stop|kill/i.test(label)).map(([v]) => v);
    expect(stops).toEqual([31]);
  });
});
