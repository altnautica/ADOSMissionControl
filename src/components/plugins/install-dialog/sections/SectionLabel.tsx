/**
 * @module SectionLabel
 * @description Uppercase heading shared by the install review sections.
 *
 * @license GPL-3.0-only
 */

export function SectionLabel({ label }: { label: string }) {
  return (
    <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
      {label}
    </h3>
  );
}
