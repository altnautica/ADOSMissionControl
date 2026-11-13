// Release-notes helpers shared by scripts/release-prepare.mjs, the
// `update-release-notes` job of .github/workflows/desktop-release.yml (loaded
// there with `require`, hence CommonJS) and tests/unit/release-notes.test.ts.
'use strict';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The body of `## [version] ...` up to the next `## [` heading or end of file,
// trimmed; null when the heading is absent or its body is empty.
function extractSection(changelog, version) {
  const re = new RegExp(
    `^## \\[${escapeRe(version)}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|$(?![\\s\\S]))`,
    'm',
  );
  const match = changelog.match(re);
  if (!match) return null;
  const body = match[1].trim();
  return body ? body : null;
}

// Wording a public release note never carries: defect framing, em dashes,
// internal planning ids, and anything shaped like a short commit sha.
const FORBIDDEN =
  /fake|fabricat|invent|phantom|\blie[sd]?\b|lying|dishonest|\bhonest|—|DEC-[0-9]|MSN-[0-9]|Wave [0-9]|Phase [0-9]|[Rr]ule #?[0-9]|\b[0-9a-f]{8}\b/i;

function forbiddenHits(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (FORBIDDEN.test(line)) hits.push({ line: i + 1, text: line });
  });
  return hits;
}

const UNRELEASED_RE = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/m;

// The [Unreleased] body (untrimmed) and the 1-based line number of its first
// line, or null when the heading is absent.
function unreleasedSection(changelog) {
  const match = changelog.match(UNRELEASED_RE);
  if (!match) return null;
  const headingLine = changelog.slice(0, match.index).split('\n').length;
  return { body: match[1], firstLine: headingLine + 1, start: match.index, end: match.index + match[0].length };
}

// Turn the [Unreleased] body into `## [version] - date`, leaving an empty
// [Unreleased] heading above it and every other byte unchanged.
function promoteUnreleased(changelog, version, date) {
  const section = unreleasedSection(changelog);
  if (!section) throw new Error('CHANGELOG.md has no ## [Unreleased] section');
  if (!/^- /m.test(section.body)) {
    throw new Error('the [Unreleased] section is empty: write the release notes first');
  }
  return (
    changelog.slice(0, section.start) +
    `## [Unreleased]\n\n## [${version}] - ${date}\n` +
    section.body +
    changelog.slice(section.end)
  );
}

const MAX_LISTED_COMMITS = 300;

// A collapsed list of every commit between two tags plus a compare link.
// `commits` is [{ sha, subject }], oldest first.
function commitListMarkdown({ commits, prevTag, tag, repoUrl }) {
  if (!prevTag) return '';
  const kept = commits.filter((c) => !c.subject.startsWith('chore(release):'));
  if (kept.length === 0) return '';
  const listed = kept.slice(-MAX_LISTED_COMMITS);
  const lines = listed.map((c) => {
    const subject = c.subject.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `- ${subject} ([${c.sha.slice(0, 7)}](${repoUrl}/commit/${c.sha}))`;
  });
  const omitted = kept.length - listed.length;
  if (omitted > 0) lines.unshift(`- … and ${omitted} earlier commits (see the full diff)`);
  return [
    '<details>',
    `<summary>All ${kept.length} commits since ${prevTag}</summary>`,
    '',
    ...lines,
    '',
    '</details>',
    '',
    `Full diff: [${prevTag}...${tag}](${repoUrl}/compare/${prevTag}...${tag})`,
  ].join('\n');
}

// `macos` is false when the release ships no .dmg (the macOS build is off).
function releaseBody({ tag, section, commitList, macos = true }) {
  return [
    `## Altnautica Command ${tag}`,
    '',
    section,
    '',
    ...(commitList ? [commitList, ''] : []),
    '---',
    '',
    '### Downloads',
    '',
    ...(macos ? ['- **macOS:** `.dmg` (Intel and Apple Silicon), unsigned and not notarized'] : []),
    '- **Windows:** `.exe` installer, unsigned',
    '- **Linux:** `.AppImage`',
    '',
    'These installers are not code-signed. Check a download against',
    '`SHA256SUMS` in this release (`sha256sum -c SHA256SUMS --ignore-missing`).',
    '',
    '> For the latest web version, visit [command.altnautica.com](https://command.altnautica.com).',
  ].join('\n');
}

module.exports = {
  extractSection,
  FORBIDDEN,
  forbiddenHits,
  unreleasedSection,
  promoteUnreleased,
  commitListMarkdown,
  releaseBody,
};
