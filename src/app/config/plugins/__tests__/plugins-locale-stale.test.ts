/**
 * @license GPL-3.0-only
 *
 * The plugins overview is read-only; installing happens from a node's own
 * Extensions tab. No locale may still carry the old installer text (target
 * picker, drop zone) that described UI the page no longer has.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const LOCALES_DIR = resolve(__dirname, "../../../../../locales");

/** English text from the old installer design, superseded in en. */
const SUPERSEDED: Record<string, string> = {
  pageBlurb:
    "Browse and manage extensions. Extensions install on a drone — pick the target below, or install from that drone's Extensions tab. They run sandboxed and only do what their granted permissions allow.",
  emptyTitle: "No extensions installed yet.",
  emptyBlurb: "Drag a .adosplug file or pick one to install.",
};

const codes = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

describe("plugins overview wording", () => {
  it.each(codes)("%s carries no superseded installer text", (code) => {
    const plugins = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf-8")).plugins as Record<string, string>;
    for (const [key, old] of Object.entries(SUPERSEDED)) expect(plugins[key], `${code} plugins.${key}`).not.toBe(old);
  });
});
