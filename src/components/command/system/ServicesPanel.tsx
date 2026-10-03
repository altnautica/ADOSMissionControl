"use client";

/**
 * @module ServicesPanel
 * @description systemd-style service list with a restart action and
 * per-service CPU and memory readouts.
 * @license GPL-3.0-only
 */

import { Server } from "lucide-react";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { ServiceTable } from "../shared/ServiceTable";
import { CollapsibleSection } from "./shared";

export function ServicesPanel() {
  const services = useAgentSystemStore((s) => s.services);
  const restartService = useAgentSystemStore((s) => s.restartService);

  return (
    <CollapsibleSection
      title="Services"
      icon={Server}
      defaultOpen={true}
      badge={services.length > 0 ? services.length : undefined}
    >
      {services.length > 0 ? (
        <ServiceTable
          services={services}
          onRestart={restartService}
        />
      ) : (
        <p className="text-xs text-text-tertiary py-4 text-center">
          No service data available
        </p>
      )}
    </CollapsibleSection>
  );
}
