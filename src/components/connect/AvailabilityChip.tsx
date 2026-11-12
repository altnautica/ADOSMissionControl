/**
 * @module AvailabilityChip
 * @description Small badge showing whether a connection method works on the
 * current surface. Driven by the {@link MethodAvailability} from the availability
 * model so the wording stays consistent everywhere.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { MethodAvailability } from "@/lib/connect/connection-methods";

const STYLE: Record<
  MethodAvailability,
  { variant: "success" | "warning" | "info"; key: string }
> = {
  available: { variant: "success", key: "chip.available" },
  "chromium-only": { variant: "warning", key: "chip.chromiumOnly" },
  "desktop-or-bridge": { variant: "info", key: "chip.desktopOrBridge" },
  "desktop-unsupported": { variant: "warning", key: "chip.desktopUnsupported" },
};

export function AvailabilityChip({
  availability,
}: {
  availability: MethodAvailability;
}) {
  const t = useTranslations("connect");
  const { variant, key } = STYLE[availability];
  return (
    <Badge variant={variant} size="sm">
      {t(key)}
    </Badge>
  );
}
