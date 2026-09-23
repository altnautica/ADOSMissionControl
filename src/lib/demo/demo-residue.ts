/**
 * @module lib/demo/demo-residue
 * @description Removes demo data from the persisted stores by its fixed ids,
 * never touching a real fleet's nodes or plans.
 * @license GPL-3.0-only
 */

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { DEMO_LAN_NODE_IDS, DEMO_MISSION_FOLDER_ID, isDemoPlanId } from "./demo-ids";

/** Remove ONLY the demo LAN nodes by their fixed device ids. */
export function clearDemoLanNodes(): void {
  const store = useLocalNodesStore.getState();
  for (const deviceId of DEMO_LAN_NODE_IDS) store.removeNode(deviceId);
}

/** Remove the demo plans and their folder from the plan library, if present. */
export function stripDemoPlans(): void {
  const lib = usePlanLibraryStore.getState();
  if (!lib.plans.some((p) => isDemoPlanId(p.id)) && !lib.folders.some((f) => f.id === DEMO_MISSION_FOLDER_ID)) return;
  usePlanLibraryStore.setState((s) => ({
    plans: s.plans.filter((p) => !isDemoPlanId(p.id)),
    folders: s.folders.filter((f) => f.id !== DEMO_MISSION_FOLDER_ID),
    expandedFolders: s.expandedFolders.filter((id) => id !== DEMO_MISSION_FOLDER_ID),
    activePlanId: isDemoPlanId(s.activePlanId) ? null : s.activePlanId,
  }));
}
