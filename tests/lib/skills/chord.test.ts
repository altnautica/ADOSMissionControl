/**
 * Unit tests for the shared chord encoder used by the dispatcher and the
 * binding-capture UI: canonical chord building, the reserved-chord guard, the
 * capture wrapper (Escape -> "escape"), and the display formatter.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  canonicalChord,
  captureChord,
  isReservedChord,
  formatChord,
} from "@/lib/skills/chord";

// Minimal KeyboardEvent stand-in: the encoder reads code/key + modifier flags.
function ev(init: {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key ?? "",
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe("canonicalChord", () => {
  it("lower-cases a printable letter", () => {
    expect(canonicalChord(ev({ key: "A", code: "KeyA", shiftKey: true }))).toBe(
      "shift+a",
    );
  });

  it("derives digits from the code, not the shifted key", () => {
    // Shift+1 yields "!" as the key but Digit1 as the code.
    expect(canonicalChord(ev({ key: "!", code: "Digit1", shiftKey: true }))).toBe(
      "shift+1",
    );
  });

  it("encodes function keys from the code", () => {
    expect(canonicalChord(ev({ key: "F1", code: "F1" }))).toBe("f1");
  });

  it("orders modifiers ctrl+alt+shift+meta", () => {
    expect(
      canonicalChord(
        ev({
          key: "k",
          code: "KeyK",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBe("ctrl+alt+shift+meta+k");
  });

  it("returns null for a bare modifier / non-printable key", () => {
    expect(canonicalChord(ev({ key: "Shift", code: "ShiftLeft" }))).toBeNull();
  });
});

describe("isReservedChord", () => {
  it("rejects the globally-reserved chords", () => {
    for (const chord of [
      "escape",
      "meta+k",
      "ctrl+k",
      "ctrl+s",
      "ctrl+shift+s",
      "ctrl+r",
      // The bare digits 1..9 are owned by the cockpit stream switcher.
      "1",
      "5",
      "9",
    ]) {
      expect(isReservedChord(chord)).toBe(true);
    }
  });

  it("accepts ordinary bindable chords", () => {
    // "0" stays bindable — only 1..9 map to the Nth stream.
    for (const chord of ["shift+a", "f4", "q", "0", "alt+g"]) {
      expect(isReservedChord(chord)).toBe(false);
    }
  });
});

describe("captureChord", () => {
  it("maps Escape to the literal reserved 'escape'", () => {
    expect(captureChord(ev({ key: "Escape", code: "Escape" }))).toBe("escape");
  });

  it("otherwise behaves like canonicalChord", () => {
    expect(captureChord(ev({ key: "r", code: "KeyR" }))).toBe("r");
  });
});

describe("formatChord", () => {
  it("renders modifier glyphs and an upper-cased key", () => {
    expect(formatChord("shift+a")).toBe("⇧A");
    expect(formatChord("ctrl+shift+s")).toBe("⌃⇧S");
    expect(formatChord("f1")).toBe("F1");
    expect(formatChord("1")).toBe("1");
  });
});
