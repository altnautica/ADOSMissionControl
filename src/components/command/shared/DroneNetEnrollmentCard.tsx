"use client";

/**
 * @module DroneNetEnrollmentCard
 * @description Shows DroneNet enrollment status or enrollment form.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";

export function DroneNetEnrollmentCard() {
  const enrollment = useAgentScriptsStore((s) => s.enrollment);
  const fetchEnrollment = useAgentScriptsStore((s) => s.fetchEnrollment);

  useEffect(() => {
    fetchEnrollment();
  }, [fetchEnrollment]);

  if (!enrollment) return null;

  if (enrollment.enrolled) {
    return (
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-3">
          <Globe size={14} className="text-accent-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            DroneNet Enrollment
          </h3>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-status-success/15 text-status-success ml-auto">
            <Check size={10} />
            Enrolled
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-tertiary">Drone ID</span>
            <p className="text-text-primary font-mono mt-0.5 text-[11px]">
              {enrollment.droneId}
            </p>
          </div>
          <div>
            <span className="text-text-tertiary">Fleet</span>
            <p className="text-text-primary mt-0.5">{enrollment.fleetName}</p>
          </div>
          <div>
            <span className="text-text-tertiary">Tier</span>
            <p className="text-text-primary font-mono mt-0.5">
              Tier {enrollment.tier}
            </p>
          </div>
          <div>
            <span className="text-text-tertiary">Enrolled Since</span>
            <p className="text-text-secondary mt-0.5 text-[11px]">
              {enrollment.enrolledSince
                ? new Date(enrollment.enrolledSince).toLocaleDateString("en-IN")
                : "--"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={14} className="text-text-tertiary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          DroneNet Enrollment
        </h3>
        <span className="text-[10px] text-text-tertiary ml-auto">Not enrolled</span>
      </div>
      <p className="text-xs text-text-tertiary mb-3">
        Join a DroneNet fleet for cloud telemetry, fleet management, and swarm coordination.
      </p>
      <button className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded hover:opacity-90 transition-opacity">
        Enroll Now
      </button>
    </div>
  );
}
