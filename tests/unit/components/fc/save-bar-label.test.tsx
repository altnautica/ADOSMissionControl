/**
 * The save / flash / revert bar text of every parameter panel comes from the
 * shared `panelCommit.bar.*` keys, never an English literal in the panel.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SaveBarLabel } from "@/components/fc/shared/SaveBarLabel";

const BAR_LITERALS = [
  "Save to Flight Controller",
  "Save to RAM",
  "Write to Flash",
  "Revert",
  "Connect a drone to save parameters",
  "Unsaved changes",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("parameter panel save bar", () => {
  it("has no English bar literal left as JSX text", () => {
    const roots = ["src/components/fc", "src/components/config", "src/components/dashboard/drone-scripts"];
    const offenders: string[] = [];
    for (const file of roots.flatMap((r) => walk(join(process.cwd(), r)))) {
      const src = readFileSync(file, "utf8");
      for (const text of BAR_LITERALS) {
        const re = new RegExp(`(>|/>)\\s*${text}\\s*<`);
        if (re.test(src)) offenders.push(`${file.replace(process.cwd() + "/", "")}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders the shared text through the translator", () => {
    render(
      <NextIntlClientProvider locale="de" messages={{ panelCommit: { bar: { writeToFlash: "In Flash schreiben" } } }}>
        <SaveBarLabel k="writeToFlash" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("In Flash schreiben")).toBeDefined();
  });
});
