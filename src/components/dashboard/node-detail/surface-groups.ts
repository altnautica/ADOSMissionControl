/**
 * @module node-detail/surface-groups
 * @description The tab-strip section labels, shared by every profile.
 *
 * These are profile-neutral on purpose. The bands used to be keyed off
 * `command.groundStation.groups.*` — which the workstation then borrowed for
 * its own header — so renaming ground-station copy silently renamed a
 * workstation band, and the same concept was labelled differently depending on
 * which node the operator had open.
 * @license GPL-3.0-only
 */

/** "How is this node" — the overview, the live surfaces, the cockpit. */
export const STATUS_GROUP = "nodeDetail.groups.status";
/** "How is this aircraft set up" — FC configuration and the control link. */
export const VEHICLE_GROUP = "nodeDetail.groups.vehicle";
/** Radio / IP transport surfaces on a ground node. */
export const LINK_GROUP = "nodeDetail.groups.link";
/** The physical box: display, buttons, attached peripherals. */
export const DEVICE_GROUP = "nodeDetail.groups.device";
/** Job execution pages an extension adds to a workstation. */
export const COMPUTE_GROUP = "nodeDetail.groups.compute";
