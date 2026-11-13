import { describe, expect, it } from "vitest";
import notes from "../../scripts/release-notes.cjs";

const RELEASES = [
  "# Changelog",
  "",
  "## [1.2.0] - 2026-10-20",
  "",
  "### Added",
  "",
  "- **Newest.** a",
  "",
  "## [1.1.0] - 2026-10-10",
  "",
  "### Fixed",
  "",
  "- **Middle.** b",
  "",
  "## [1.0.0] - 2026-10-01",
  "",
  "- **Oldest.** c",
  "",
].join("\n");

const OLDER = "## [1.1.0] - 2026-10-10\n\n### Fixed\n\n- **Old.** z\n";

describe("extractSection", () => {
  it("returns a middle section up to the next heading", () => {
    expect(notes.extractSection(RELEASES, "1.1.0")).toBe("### Fixed\n\n- **Middle.** b");
  });

  it("returns the last section when it runs to end of file", () => {
    expect(notes.extractSection(RELEASES, "1.0.0")).toBe("- **Oldest.** c");
  });

  it("treats the dots in a version literally", () => {
    expect(notes.extractSection(RELEASES, "1x1x0")).toBeNull();
  });

  it("returns null for a missing version or a blank body", () => {
    expect(notes.extractSection(RELEASES, "9.9.9")).toBeNull();
    expect(notes.extractSection("## [2.0.0] - 2026-10-22\n  \n\n## [1.0.0]\n- x\n", "2.0.0")).toBeNull();
  });
});

describe("promoteUnreleased", () => {
  it("moves the [Unreleased] body under the version and leaves older sections byte-identical", () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n### Added\n\n- **X.** y\n\n${OLDER}`;
    const promoted = notes.promoteUnreleased(changelog, "1.2.0", "2026-10-22");
    expect(promoted).toBe(
      `# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-10-22\n### Added\n\n- **X.** y\n\n${OLDER}`,
    );
    expect(notes.extractSection(promoted, "1.2.0")).toBe("### Added\n\n- **X.** y");
  });

  it("refuses an [Unreleased] section with headings but no entries", () => {
    expect(() =>
      notes.promoteUnreleased(`## [Unreleased]\n\n### Added\n\n${OLDER}`, "1.2.0", "2026-10-22"),
    ).toThrow("the [Unreleased] section is empty: write the release notes first");
  });

  it("refuses a changelog with no [Unreleased] heading", () => {
    expect(() => notes.promoteUnreleased(OLDER, "1.2.0", "2026-10-22")).toThrow(
      "CHANGELOG.md has no ## [Unreleased] section",
    );
  });
});

describe("forbiddenHits", () => {
  it("reports the 1-based line of a forbidden word", () => {
    expect(notes.forbiddenHits("ok\nan honest gauge\nfine")).toEqual([
      { line: 2, text: "an honest gauge" },
    ]);
  });

  it("matches words that start with a forbidden stem", () => {
    expect(notes.forbiddenHits("Honesty")).toHaveLength(1);
  });

  it("flags em dashes, short planning ids and sha-shaped tokens", () => {
    const text = "a \u2014 b\nsee MSN-7\nfixed in 1a2b3c4d\nplain line";
    expect(notes.forbiddenHits(text).map((h) => h.line)).toEqual([1, 2, 3]);
  });
});

describe("commitListMarkdown", () => {
  const base = {
    prevTag: "v1.1.0",
    tag: "v1.2.0",
    repoUrl: "https://github.com/example/repo",
  };

  it("drops release commits, escapes HTML and links the full diff", () => {
    const md = notes.commitListMarkdown({
      ...base,
      commits: [
        { sha: "a".repeat(40), subject: "chore(release): 1.1.0" },
        { sha: "b".repeat(40), subject: "Render <b> safely" },
      ],
    });
    expect(md).toContain("<summary>All 1 commits since v1.1.0</summary>");
    expect(md).not.toContain("chore(release)");
    expect(md).toContain(
      `- Render &lt;b&gt; safely ([bbbbbbb](https://github.com/example/repo/commit/${"b".repeat(40)}))`,
    );
    expect(md).toContain(
      "Full diff: [v1.1.0...v1.2.0](https://github.com/example/repo/compare/v1.1.0...v1.2.0)",
    );
  });

  it("returns nothing without a previous tag", () => {
    expect(
      notes.commitListMarkdown({ ...base, prevTag: null, commits: [{ sha: "c".repeat(40), subject: "x" }] }),
    ).toBe("");
  });
});

describe("releaseBody", () => {
  const base = { tag: "v1.2.0", section: "### Added\n- x", commitList: "" };

  it("lists the macOS installers by default", () => {
    expect(notes.releaseBody(base)).toContain("- **macOS:**");
  });

  it("leaves macOS out of Downloads when the release has no .dmg", () => {
    const body = notes.releaseBody({ ...base, macos: false });
    expect(body).not.toContain("macOS");
    expect(body).toContain("- **Windows:**");
    expect(body).toContain("- **Linux:**");
  });
});
