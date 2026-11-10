// Text from the cockpit spec's string table (`setup-strings.json`) with
// single-brace `{arg}` interpolation: the pilot's banners
// (`pilot.banner.fc_control {mode}`), the flow screens (`flow.*`), the voice
// prompts (`voice.*`), refusals, alerts and tips. Enumerated arg values resolve
// through their own keys (`pilot.banner.source.rc`,
// `pilot.link_loss_action.rth`). Pure: imports only the spec.

import stringsJson from "../cockpit-spec/setup-strings.json";

const STRINGS: Readonly<Record<string, string>> = stringsJson.strings as Record<string, string>;

/** Arg names whose values are keys of their own. */
const ARG_KEYS: Readonly<Record<string, string>> = {
  source: "pilot.banner.source.",
  action: "pilot.link_loss_action.",
};

/** Whether the spec carries `key`. */
export function hasSpecText(key: string): boolean {
  return STRINGS[key] !== undefined;
}

/** Whether the spec text at `key` is a template that takes `{arg}`s. */
export function specTakesArgs(key: string): boolean {
  return /\{[a-z_]+\}/.test(STRINGS[key] ?? "");
}

/** A string by key with `{arg}` filled; an unknown key reads as itself. A
 *  missing arg fills as empty; `profile` and `mode` read upper case. */
export function specText(key: string, args: Readonly<Record<string, unknown>> = {}): string {
  const template = STRINGS[key];
  if (template === undefined) return key;
  return template.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const v = args[name];
    if (v === null || v === undefined) return "";
    const s = String(v);
    const prefix = ARG_KEYS[name];
    if (prefix && STRINGS[prefix + s] !== undefined) return STRINGS[prefix + s];
    if (name === "profile" || name === "mode") return s.toUpperCase();
    return s;
  });
}
