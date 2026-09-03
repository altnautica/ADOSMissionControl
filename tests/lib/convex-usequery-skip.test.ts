/**
 * Enforces the project's Convex read rule over every call site in `src/`.
 *
 * THE RULE: a Convex `useQuery` must be able to not run. It has to skip when
 * the deployment is unavailable (self-host with no Convex, offline desktop),
 * when demo mode is on, and when the runtime context the args need has not
 * arrived. `useQuery` also throws SYNCHRONOUSLY DURING RENDER when the
 * deployment lacks the function, the args fail validation, or the handler threw
 * — including the "Not authenticated" a session expiry produces — and a throw
 * out of render reaches the nearest `error.tsx`. `CloudCommandAckWatcher`
 * mounted one such subscription per in-flight cloud command with no skip and no
 * guard, so a session that expired mid-command black-screened the nodes view.
 *
 * There are exactly two compliant shapes:
 *   1. `useConvexSkipQuery(...)` — the wrapper that owns the skip decision and
 *      traps the render-time throw.
 *   2. A bare `useQuery(...)` that passes `"skip"` as its own argument
 *      expression, for a call site that computes its own gate.
 *
 * This is a source scan rather than an ESLint rule on purpose: the rule is a
 * property of an ARGUMENT (does this call have a reachable skip?), the repo has
 * no local ESLint plugin to hang a custom rule on, and adding one to express a
 * single project rule is more machinery than the rule is worth. A test fails
 * the same `vitest run` CI already gates on.
 *
 * @license GPL-3.0-only
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/**
 * The one file allowed to call `useQuery` with neither shape: it IS the
 * wrapper, and it owns the skip decision and the try/catch for everyone else.
 */
const WRAPPER = path.join("hooks", "use-convex-skip-query.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Text of each `useQuery(...)` call in `source`, brace/paren matched from the
 * opening parenthesis so the whole argument list is inspected — a `"skip"`
 * nested inside a ternary two lines down still counts, and a `"skip"` belonging
 * to the NEXT call does not.
 */
function useQueryCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /\buseQuery\s*\(/g;
  for (const match of source.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          calls.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return calls;
}

const SKIP_LITERAL = /["']skip["']/;

/**
 * Whether a `useQuery(...)` argument list can evaluate to `"skip"`.
 *
 * Literally present in the call is the common case. The second accepted shape
 * is an args expression hoisted into a local const — `useQuery(ref, cloudArgs)`
 * where `cloudArgs` is a `useMemo` returning either real args or `"skip"`
 * (`PluginInstallProgress` does exactly this, and hoisting is the right call
 * there because the gate depends on three inputs). Resolving one level of
 * same-file identifier keeps that legal while still failing a call that has no
 * skip anywhere. The rule is a property of the ARGUMENT, so a text-only match
 * would reject a correct call site and push authors toward disabling the check.
 */
function hasReachableSkip(call: string, source: string): boolean {
  if (SKIP_LITERAL.test(call)) return true;
  // Second argument of `(queryRef, args)`, when it is a bare identifier
  // (optionally with a trailing `as` cast).
  const argsMatch = call.match(/,\s*([A-Za-z_$][\w$]*)\s*(?:as\s[^,()]+)?\s*\)$/);
  const name = argsMatch?.[1];
  if (!name) return false;
  const declIndex = source.search(
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`),
  );
  if (declIndex === -1) return false;
  // Declaration through to the start of the useQuery call: the memo body.
  const region = source.slice(declIndex, source.indexOf(call, declIndex));
  return SKIP_LITERAL.test(region);
}

describe("Convex useQuery call sites", () => {
  const files = sourceFiles(SRC);

  it("scans a non-trivial number of source files", () => {
    // A broken walker produces an empty scan, which reads exactly like a clean
    // tree. Floor it so the parser failing is a failure, not a vacuous pass.
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds the call sites it is meant to police", () => {
    const withCalls = files.filter((f) =>
      useQueryCalls(readFileSync(f, "utf8")).length > 0,
    );
    expect(withCalls.length).toBeGreaterThan(0);
  });

  it("every bare useQuery has a reachable \"skip\"", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (rel === WRAPPER) continue;
      const source = readFileSync(file, "utf8");
      // A file that only routes through the wrapper never matches `useQuery(`
      // at all; the scan below is for files importing it from convex/react.
      for (const call of useQueryCalls(source)) {
        if (hasReachableSkip(call, source)) continue;
        offenders.push(`${rel}: useQuery${call.split("\n")[0]}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no component imports useQuery from convex/react without using the skip form", () => {
    // Catches the other half: importing `useQuery` and then aliasing or
    // re-exporting it, which the call scan above would not see.
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (rel === WRAPPER) continue;
      const source = readFileSync(file, "utf8");
      if (!/import\s*\{[^}]*\buseQuery\b[^}]*\}\s*from\s*["']convex\/react["']/.test(source)) {
        continue;
      }
      const calls = useQueryCalls(source);
      if (calls.length === 0) {
        offenders.push(`${rel}: imports useQuery from convex/react but never calls it`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
