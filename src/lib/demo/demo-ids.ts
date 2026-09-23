/**
 * @module lib/demo/demo-ids
 * @description The fixed ids demo mode seeds under, so demo data can be found
 * and removed without loading the demo fleet itself. Imported by the always-on
 * residue sweep, so it must stay free of any mock import.
 * @license GPL-3.0-only
 */

/** The plan-library folder the demo missions are seeded into. */
export const DEMO_MISSION_FOLDER_ID = "demo-missions-folder";

/** Demo plan ids share this prefix, so seeding and teardown never touch real plans. */
export function isDemoPlanId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("demo-");
}

/** Device ids of the demo drones seeded as LAN-paired nodes. */
export const DEMO_LAN_NODE_IDS = ["foxtrot-6", "mike-13"] as const;
