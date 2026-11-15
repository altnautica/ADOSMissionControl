/**
 * @module tests/helpers/app-dynamic
 * @description Under vitest `next/dynamic` resolves to the pages-router
 * loadable, which never suspends. The Next app build aliases it to the
 * app-router dynamic instead (React.lazy, with a Suspense boundary only when
 * the call passes `loading` or `ssr: false`). Tests about lazy-load
 * suspension mock `next/dynamic` with this module so they run what ships:
 *
 *   vi.mock("next/dynamic", async () =>
 *     (await import("<path>/tests/helpers/app-dynamic")).appDynamicModule());
 * @license GPL-3.0-only
 */

/** Unwrap CommonJS interop: the export may sit under one or two `default`s. */
function unwrapDefault(m: unknown): unknown {
  let v = m;
  while (typeof v !== "function" && v && typeof v === "object" && "default" in v) v = v.default;
  return v;
}

export async function appDynamicModule(): Promise<{ default: unknown }> {
  const dynamic = unwrapDefault(await import("next/dist/shared/lib/app-dynamic"));
  if (typeof dynamic !== "function") throw new Error("next app-router dynamic did not load");
  return { default: dynamic };
}
