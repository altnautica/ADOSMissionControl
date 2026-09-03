/**
 * @module fakeConvexCtx
 * @description A minimal in-memory stand-in for the Convex `ctx` so the REAL
 * exported handlers can be invoked in a unit test.
 *
 * This exists because the alternative was another round of source-text
 * assertions. A test that greps a handler for the string `apiKey` proves
 * nothing about what the handler RETURNS, and "no path returns an agent
 * credential to an anonymous caller" is a claim about return values. Convex's
 * registered functions expose their handler as `._handler`, so calling it with
 * a fake ctx exercises the real guard ladder, the real ordering, and the real
 * response shape.
 *
 * Scope is deliberately the shapes the functions under test actually use:
 * `withIndex` with eq/lt/gt/gte range constraints, `filter` with the
 * field/eq expression builder, `first`/`take`/`collect`/`order`, and
 * insert/patch/delete/get. Anything else throws rather than silently
 * returning nothing — a fake that quietly answers "no rows" to a query it does
 * not understand makes a guard look like it fired when it never ran.
 *
 * @license GPL-3.0-only
 */

export interface FakeRow {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
}

type Predicate = (row: FakeRow) => boolean;

interface FieldRef {
  __field: string;
}

function isFieldRef(value: unknown): value is FieldRef {
  return typeof value === "object" && value !== null && "__field" in value;
}

/** Index range builder: records eq/lt/lte/gt/gte as row predicates. */
class RangeBuilder {
  readonly predicates: Predicate[] = [];

  eq(field: string, value: unknown): this {
    this.predicates.push((row) => row[field] === value);
    return this;
  }
  lt(field: string, value: number): this {
    this.predicates.push((row) => Number(row[field]) < value);
    return this;
  }
  lte(field: string, value: number): this {
    this.predicates.push((row) => Number(row[field]) <= value);
    return this;
  }
  gt(field: string, value: number): this {
    this.predicates.push((row) => Number(row[field]) > value);
    return this;
  }
  gte(field: string, value: string | number): this {
    this.predicates.push(
      (row) => (row[field] as string | number) >= value,
    );
    return this;
  }
}

class FakeQuery {
  constructor(private rows: FakeRow[]) {}

  withIndex(_index: string, build?: (q: RangeBuilder) => unknown): FakeQuery {
    if (!build) return new FakeQuery([...this.rows]);
    const builder = new RangeBuilder();
    build(builder);
    return new FakeQuery(
      this.rows.filter((row) => builder.predicates.every((p) => p(row))),
    );
  }

  filter(build: (q: {
    field: (name: string) => FieldRef;
    eq: (a: unknown, b: unknown) => Predicate;
    neq: (a: unknown, b: unknown) => Predicate;
  }) => Predicate): FakeQuery {
    const resolve = (value: unknown, row: FakeRow) =>
      isFieldRef(value) ? row[value.__field] : value;
    const predicate = build({
      field: (name) => ({ __field: name }),
      eq: (a, b) => (row) => resolve(a, row) === resolve(b, row),
      neq: (a, b) => (row) => resolve(a, row) !== resolve(b, row),
    });
    return new FakeQuery(this.rows.filter(predicate));
  }

  order(direction: "asc" | "desc"): FakeQuery {
    const sorted = [...this.rows].sort((a, b) =>
      direction === "desc"
        ? b._creationTime - a._creationTime
        : a._creationTime - b._creationTime,
    );
    return new FakeQuery(sorted);
  }

  async first(): Promise<FakeRow | null> {
    return this.rows[0] ?? null;
  }
  async unique(): Promise<FakeRow | null> {
    if (this.rows.length > 1) throw new Error("unique() matched multiple rows");
    return this.rows[0] ?? null;
  }
  async take(n: number): Promise<FakeRow[]> {
    return this.rows.slice(0, n);
  }
  async collect(): Promise<FakeRow[]> {
    return [...this.rows];
  }
}

export class FakeDb {
  private tables = new Map<string, FakeRow[]>();
  private owner = new Map<string, string>();
  private seq = 0;

  /** Seed rows into a table. Each gets a synthetic `_id` and `_creationTime`. */
  seed(table: string, rows: Array<Record<string, unknown>>): FakeRow[] {
    return rows.map((row) => this.insertSync(table, row));
  }

  rows(table: string): FakeRow[] {
    return this.tables.get(table) ?? [];
  }

  private insertSync(table: string, doc: Record<string, unknown>): FakeRow {
    this.seq += 1;
    const row: FakeRow = {
      ...doc,
      _id: `${table}:${this.seq}`,
      _creationTime: this.seq,
    };
    const list = this.tables.get(table) ?? [];
    list.push(row);
    this.tables.set(table, list);
    this.owner.set(row._id, table);
    return row;
  }

  query(table: string): FakeQuery {
    return new FakeQuery([...(this.tables.get(table) ?? [])]);
  }

  async insert(table: string, doc: Record<string, unknown>): Promise<string> {
    return this.insertSync(table, doc)._id;
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const row = this.findById(id);
    if (!row) throw new Error(`patch: no such row ${id}`);
    Object.assign(row, updates);
  }

  async delete(id: string): Promise<void> {
    const table = this.owner.get(id);
    if (!table) throw new Error(`delete: no such row ${id}`);
    this.tables.set(
      table,
      (this.tables.get(table) ?? []).filter((row) => row._id !== id),
    );
    this.owner.delete(id);
  }

  async get(id: string): Promise<FakeRow | null> {
    return this.findById(id);
  }

  private findById(id: string): FakeRow | null {
    const table = this.owner.get(id);
    if (!table) return null;
    return (this.tables.get(table) ?? []).find((row) => row._id === id) ?? null;
  }
}

export interface FakeCtxOptions {
  /** Authenticated subject, or undefined for an anonymous caller. */
  subject?: string;
  email?: string;
  /** Dispatcher for `ctx.runMutation` / `ctx.runQuery`. */
  run?: (ref: unknown, args: unknown) => Promise<unknown>;
}

export interface FakeCtx {
  db: FakeDb;
  auth: { getUserIdentity: () => Promise<{ subject: string; email?: string } | null> };
  scheduler: { runAfter: (delay: number, ref: unknown, args: unknown) => Promise<void> };
  scheduled: Array<{ ref: unknown; args: unknown }>;
  runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
  runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
}

export function makeCtx(options: FakeCtxOptions = {}): FakeCtx {
  const scheduled: Array<{ ref: unknown; args: unknown }> = [];
  const run =
    options.run ??
    (async () => {
      throw new Error("ctx.run* called with no dispatcher configured");
    });
  return {
    db: new FakeDb(),
    auth: {
      getUserIdentity: async () =>
        options.subject
          ? { subject: options.subject, email: options.email }
          : null,
    },
    scheduler: {
      runAfter: async (_delay, ref, args) => {
        scheduled.push({ ref, args });
      },
    },
    scheduled,
    runMutation: run,
    runQuery: run,
  };
}

/**
 * Invoke a registered Convex function's real handler.
 *
 * `_handler` is the property Convex's own `mutationGeneric`/`queryGeneric`
 * attach to the value they return, and it is what a Convex test harness calls
 * too. Reached through a narrowing guard rather than a cast so a future Convex
 * release that renames it fails here with a clear message instead of silently
 * making every test in this file vacuous.
 */
export async function invoke(
  fn: unknown,
  ctx: unknown,
  args: unknown = {},
): Promise<unknown> {
  if (typeof fn !== "function" || !("_handler" in fn)) {
    throw new Error("not a registered Convex function: no _handler");
  }
  const handler = fn._handler;
  if (typeof handler !== "function") {
    throw new Error("registered Convex function's _handler is not callable");
  }
  return await handler(ctx, args);
}

/**
 * Whether a registered Convex function is client-callable.
 *
 * Convex marks the two cases with DIFFERENT properties, not one boolean:
 * a public function carries `isPublic: true` and an internal one carries
 * `isInternal: true`. Reading `fn.isPublic === true` alone would therefore
 * report `false` for anything that is not a registered function at all — a
 * typo in a test would read as "correctly internal". Both markers are required
 * to be present-and-exclusive, so an unrecognised value throws.
 */
export function isPublic(fn: unknown): boolean {
  if (typeof fn !== "function") {
    throw new Error("not a registered Convex function");
  }
  const publicMarker = "isPublic" in fn && fn.isPublic === true;
  const internalMarker = "isInternal" in fn && fn.isInternal === true;
  if (publicMarker === internalMarker) {
    throw new Error(
      "not a registered Convex function: expected exactly one of isPublic / isInternal",
    );
  }
  return publicMarker;
}
