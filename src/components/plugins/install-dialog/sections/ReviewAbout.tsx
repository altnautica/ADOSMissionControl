/**
 * @module ReviewAbout
 * @description The about and features sections of the install review: the
 * manifest's short and long description (with `**bold**` headings) and its
 * feature bullets.
 *
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";

import { SectionLabel } from "./SectionLabel";

/** Render a paragraph chunk that may start with a `**Heading**` line.
 * If the first line is wrapped in `**...**`, lift it into a bold heading
 * stacked above the body. Inline `**...**` spans elsewhere in the body
 * render as <strong>. Anything else passes through as plain text with
 * `whitespace-pre-line` so single newlines in the source survive. */
function renderRichBold(text: string): ReactNode {
  const newlineIdx = text.indexOf("\n");
  const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : text.slice(newlineIdx + 1).trim();
  const headingMatch = firstLine.match(/^\*\*(.+?)\*\*[.:]?\s*$/);
  if (headingMatch) {
    return (
      <>
        <p className="mb-1 text-sm font-semibold text-text-primary">
          {headingMatch[1].replace(/\*\*(.+?)\*\*/g, "$1")}
        </p>
        {rest && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
            {renderInlineBold(rest)}
          </p>
        )}
      </>
    );
  }
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
      {renderInlineBold(text)}
    </p>
  );
}

/** Replace `**span**` runs with <strong>span</strong>. */
function renderInlineBold(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : text;
}

export function AboutSection({
  title,
  shortText,
  longText,
}: {
  title: string;
  shortText?: string;
  longText?: string;
}) {
  const paragraphs = longText
    ? longText
        .split(/\n\s*\n/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0)
    : [];
  return (
    <section>
      <SectionLabel label={title} />
      <div className="space-y-4">
        {shortText && (
          <p className="text-sm leading-relaxed text-text-primary">
            {shortText}
          </p>
        )}
        {paragraphs.map((para, idx) => (
          <div key={idx} className="space-y-0">
            {renderRichBold(para)}
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeaturesSection({
  title,
  features,
}: {
  title: string;
  features: ReadonlyArray<string>;
}) {
  return (
    <section>
      <SectionLabel label={title} />
      <ul className="space-y-1.5 text-sm text-text-secondary">
        {features.map((f, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="mt-1 text-text-tertiary" aria-hidden>
              ·
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
