/**
 * A stat tile's severity only rises with the value: a reading past the warning
 * threshold is amber, past the critical threshold red, never the reverse.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { StatBox } from "@/components/command/system/shared";

const MEM = { warn: 85, crit: 95 };

function valueClass(value: number) {
  const { getByText } = render(<StatBox label="mem" value={value} unit="%" thresholds={MEM} />);
  return getByText(`${value}%`).className;
}

describe("StatBox severity", () => {
  it("keeps a reading below the warning threshold neutral", () => {
    expect(valueClass(83)).toContain("text-text-primary");
  });

  it("colours a reading past the warning threshold amber, not red", () => {
    const cls = valueClass(90);
    expect(cls).toContain("text-status-warning");
    expect(cls).not.toContain("text-status-error");
  });

  it("colours a reading past the critical threshold red", () => {
    expect(valueClass(97)).toContain("text-status-error");
  });
});
