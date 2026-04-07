"use client";

/**
 * Shared placeholder card used by tabs whose body lands in a later phase.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";

interface PlaceholderTabProps {
  title: string;
  message: string;
}

export function PlaceholderTab({ title, message }: PlaceholderTabProps) {
  return (
    <Card title={title} padding={true}>
      <p className="text-[10px] text-text-tertiary leading-relaxed">{message}</p>
    </Card>
  );
}
