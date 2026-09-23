/**
 * @module i18n-namespace-coverage.test
 * @description Guards against the class of bug where a component calls
 * `useTranslations("X")` for a namespace that was never added to the locale
 * files. The parity test only compares locales to each other, so a namespace
 * missing from ALL locales passes it — but at runtime next-intl throws
 * `MISSING_MESSAGE` and the UI renders raw keys. This test statically scans
 * `src/` for `useTranslations("literal")` calls and asserts each namespace is a
 * top-level key in `en.json`, then resolves every static `t("key")` literal
 * against the namespace its translator was bound to and asserts it lands on a
 * string in `en.json` — a typo'd or never-added key otherwise renders the raw
 * `namespace.key` fallback in every locale while the parity test stays green.
 * (Static literals only; dynamic keys and `useTranslations()` with no argument
 * are out of scope.)
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_DIR = resolve(__dirname, "../../src");
const EN = resolve(__dirname, "../../locales/en.json");

/** Recursively collect `.ts`/`.tsx` source files (excluding test files). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every static namespace passed to `useTranslations("...")` across `src/`. */
function usedNamespaces(): Map<string, string> {
  const re = /useTranslations\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const found = new Map<string, string>(); // namespace -> first file using it
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, "utf-8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const ns = m[1];
      if (!found.has(ns)) found.set(ns, file);
    }
  }
  return found;
}

/** Resolve a (possibly dotted) namespace path in the message tree and return it
 * only when it lands on an object — a `useTranslations("a.b")` namespace must be
 * an object whose keys the component then translates. `undefined` = the path is
 * absent or points at a leaf string (not a valid namespace). */
function resolveNamespace(root: Record<string, unknown>, ns: string): unknown {
  let cur: unknown = root;
  for (const part of ns.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

describe("i18n namespace coverage", () => {
  it("every useTranslations() namespace exists in en.json", () => {
    const en = JSON.parse(readFileSync(EN, "utf-8")) as Record<string, unknown>;
    const used = usedNamespaces();
    expect(used.size).toBeGreaterThan(0); // the scan actually found calls

    const missing = [...used.entries()]
      .filter(([ns]) => {
        const resolved = resolveNamespace(en, ns);
        return resolved === null || typeof resolved !== "object" || Array.isArray(resolved);
      })
      .map(([ns, file]) => `  "${ns}" (used in ${file.replace(SRC_DIR, "src")})`)
      .sort();

    if (missing.length > 0) {
      throw new Error(
        `useTranslations() namespaces missing from locales/en.json:\n${missing.join("\n")}`,
      );
    }
  });
});

/** `const <name> = useTranslations("<ns>")` / `await getTranslations("<ns>")`. */
const BINDING = /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*["'`]([^"'`$]+)["'`]\s*\)/g;

/** Every static key each file passes to a translator it bound to a namespace. */
function usedLeafKeys(): { file: string; namespaces: string[]; key: string }[] {
  const out: { file: string; namespaces: string[]; key: string }[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, "utf-8");
    const bindings = new Map<string, Set<string>>();
    for (const m of text.matchAll(BINDING)) {
      const set = bindings.get(m[1]) ?? new Set<string>();
      set.add(m[2]);
      bindings.set(m[1], set);
    }
    for (const [name, namespaces] of bindings) {
      const call = new RegExp(`(?<![\\w.])${name}(?:\\.(?:rich|markup|raw))?\\(\\s*(["'])([^"'\\n]+)\\1`, "g");
      for (const m of text.matchAll(call)) {
        out.push({ file, namespaces: [...namespaces], key: m[2] });
      }
    }
  }
  return out;
}

describe("i18n leaf key coverage", () => {
  it("every static t(\"key\") resolves to a string in en.json", () => {
    const en = JSON.parse(readFileSync(EN, "utf-8")) as Record<string, unknown>;
    const used = usedLeafKeys();
    expect(used.length).toBeGreaterThan(1000); // the scan actually found calls

    const missing = used
      .filter(({ namespaces, key }) =>
        namespaces.every((ns) => typeof resolveNamespace(en, `${ns}.${key}`) !== "string"),
      )
      .map(({ file, namespaces, key }) => `  ${namespaces.join("|")}.${key} (${file.replace(SRC_DIR, "src")})`);

    if (missing.length > 0) {
      throw new Error(`t() keys missing from locales/en.json:\n${[...new Set(missing)].sort().join("\n")}`);
    }
  });
});
