/**
 * @module use-css-var-colors.test
 * @description Resolved theme tokens follow the root element's custom
 * properties and update when an inline override changes.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useCssVarColors } from "@/hooks/use-css-var-colors";

const NAMES = ["--test-a", "--test-b"] as const;

describe("useCssVarColors", () => {
  afterEach(() => {
    for (const n of NAMES) document.documentElement.style.removeProperty(n);
  });

  it("reads each token and re-reads after a root style change", async () => {
    const root = document.documentElement.style;
    root.setProperty("--test-a", "#112233");
    root.setProperty("--test-b", "#445566");
    const { result } = renderHook(() => useCssVarColors(NAMES));
    expect(result.current).toEqual(["#112233", "#445566"]);

    root.setProperty("--test-a", "#778899");
    await waitFor(() => expect(result.current).toEqual(["#778899", "#445566"]));
  });

  it("returns an empty string for an unset token", () => {
    const { result } = renderHook(() => useCssVarColors(["--test-a"]));
    expect(result.current).toEqual([""]);
  });
});
