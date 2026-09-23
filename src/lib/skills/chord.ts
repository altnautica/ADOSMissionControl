/**
 * Canonical keyboard-chord encoding shared by the cockpit dispatcher and the
 * binding-capture UI. Both sides MUST agree byte-for-byte on how a key event
 * maps to a chord string, otherwise a captured binding would never match at
 * dispatch time. The dispatcher and the capture overlay both import from here.
 *
 * A chord is "ctrl+alt+shift+meta+<base>" with the present modifiers in that
 * fixed order. The base is the lower-cased printable key, a digit ("0".."9"),
 * or a function key ("f1".."f24"), derived from e.code so a held Shift or a
 * keyboard layout difference never changes the chord.
 *
 * @module skills/chord
 * @license GPL-3.0-only
 */

/**
 * Build the canonical chord for a keyboard event, or null when the event has
 * no bindable base (a bare modifier, dead key, or non-printable key). Modifier
 * order is fixed so a loadout lookup and a captured binding are deterministic.
 */
export function canonicalChord(e: KeyboardEvent): string | null {
  let base: string | null = null;

  // Digit row: Digit0..Digit9 -> "0".."9".
  if (/^Digit[0-9]$/.test(e.code)) {
    base = e.code.slice(5);
  } else if (/^Numpad[0-9]$/.test(e.code)) {
    base = e.code.slice(6);
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) {
    // Function keys: F1..F24 -> "f1".."f24".
    base = e.code.toLowerCase();
  } else if (e.key.length === 1) {
    // Single printable character (letters, punctuation) -> lower-cased key.
    base = e.key.toLowerCase();
  } else {
    return null;
  }

  if (!base) return null;

  return (
    (e.ctrlKey ? "ctrl+" : "") +
    (e.altKey ? "alt+" : "") +
    (e.shiftKey ? "shift+" : "") +
    (e.metaKey ? "meta+" : "") +
    base
  );
}

/**
 * Chords the operator can never bind, because the app owns them globally:
 *   - "escape" handling is done by raw key (never produced by canonicalChord,
 *     which only emits printable/digit/function bases) — guarded here too so an
 *     Escape capture is rejected with a clear hint instead of silently ignored.
 *   - the command palette (meta+k / ctrl+k)
 *   - the FC param shortcuts (ctrl+s save, ctrl+shift+s flash, ctrl+r refresh;
 *     their meta equivalents are reserved as well since those handlers treat
 *     meta as ctrl)
 *   - the bare digits 1..9, owned globally by the cockpit stream switcher (a
 *     digit selects the Nth video stream), so a skill can never be bound to one
 *   - the bare backtick "`", owned by the cockpit stream cycle, and bare "p",
 *     owned by the picture-in-picture toggle — both are window keydowns in the
 *     cockpit, so a skill bound to either would double-fire (cycle/toggle AND
 *     the skill). Reserving them makes the collision impossible by construction.
 *   - Shift+comma, the cockpit quick-settings drawer. The cockpit matches it by
 *     physical key; the chord a held Shift produces from that key follows the
 *     layout ("shift+<" on US/UK, "shift+;" on German), so both are reserved.
 */
const RESERVED_CHORDS: ReadonlySet<string> = new Set([
  "escape",
  "meta+k",
  "ctrl+k",
  "ctrl+s",
  "meta+s",
  "ctrl+shift+s",
  "meta+shift+s",
  "ctrl+r",
  "meta+r",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "`",
  "p",
  "shift+<",
  "shift+;",
]);

/**
 * Standard-mapping gamepad buttons the cockpit owns. A skill bound to one would
 * fire alongside the cockpit's own action, so binding capture refuses them.
 */
export const COCKPIT_GAMEPAD_BUTTON = {
  /** L1 + R1 held together toggles the quick-settings drawer. */
  quickSettingsLeft: 4,
  quickSettingsRight: 5,
  /** Select / Back: held to open the skill radial. */
  radial: 8,
  /** Start: leaves immersive mode. */
  exit: 9,
  /** D-pad: aims the radial; left/right cycle the video stream. */
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const RESERVED_GAMEPAD_BUTTONS: ReadonlySet<number> = new Set(
  Object.values(COCKPIT_GAMEPAD_BUTTON),
);

/** True when a gamepad button is owned by the cockpit and must not be bound. */
export function isReservedGamepadButton(button: number): boolean {
  return RESERVED_GAMEPAD_BUTTONS.has(button);
}

/** True when a chord is globally reserved and must not be bound to a slot. */
export function isReservedChord(chord: string): boolean {
  return RESERVED_CHORDS.has(chord);
}

/**
 * Canonicalize a raw key event for binding capture. Returns the chord, or the
 * literal "escape" for an Escape press (so the capture UI can reject it with a
 * "reserved" hint rather than treating it as a cancel), or null when there is
 * no bindable base.
 */
export function captureChord(e: KeyboardEvent): string | null {
  if (e.key === "Escape") return "escape";
  return canonicalChord(e);
}

const MOD_GLYPH: Record<string, string> = {
  shift: "⇧",
  ctrl: "⌃",
  alt: "⌥",
  meta: "⌘",
};

/** Human-friendly chord label: "shift+a" -> "⇧A", "f1" -> "F1", "1" -> "1". */
export function formatChord(chord: string): string {
  const parts = chord.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const prefix = mods.map((m) => MOD_GLYPH[m] ?? m.toUpperCase()).join("");
  return prefix + key.toUpperCase();
}
