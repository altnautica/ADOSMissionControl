/**
 * Defense overlay stub — community build placeholder.
 *
 * This file exists so that CommandShell.tsx's dynamic import resolves
 * during production builds. In community builds (NEXT_PUBLIC_BUILD_TARGET
 * is not "battlenet"), the DefenseSlot renders this no-op component.
 *
 * In BattleNet builds, the overlay's DefenseProvider.tsx replaces this
 * file at build time via the build.sh overlay mechanism.
 *
 * DO NOT DELETE THIS FILE. The production build will fail without it.
 */

export default function DefenseProvider() {
  return null;
}
