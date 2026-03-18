/**
 * Generic typed ring buffer for telemetry data.
 * Fixed-capacity circular buffer — oldest entries are overwritten when full.
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _length = 0;
  private _dirty = true;
  private _cachedArray: T[] = [];

  constructor(public readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
    this._dirty = true;
  }

  /** Get item by index (0 = oldest). */
  get(index: number): T | undefined {
    if (index < 0 || index >= this._length) return undefined;
    const start = this._length < this.capacity ? 0 : this.head;
    return this.buffer[(start + index) % this.capacity];
  }

  /** Most recent entry. */
  latest(): T | undefined {
    if (this._length === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Convert to array, oldest first. Returns cached copy if unchanged since last call. */
  toArray(): T[] {
    if (this._length === 0) return [];
    if (!this._dirty) return this._cachedArray;
    const result: T[] = [];
    const start = this._length < this.capacity ? 0 : this.head;
    for (let i = 0; i < this._length; i++) {
      result.push(this.buffer[(start + i) % this.capacity] as T);
    }
    this._cachedArray = result;
    this._dirty = false;
    return result;
  }

  /** Iterate over all entries oldest-first without allocating an array. */
  forEach(fn: (item: T, index: number) => void): void {
    const start = this._length < this.capacity ? 0 : this.head;
    for (let i = 0; i < this._length; i++) {
      fn(this.buffer[(start + i) % this.capacity] as T, i);
    }
  }

  /** Last N entries, oldest first. */
  last(n: number): T[] {
    const count = Math.min(n, this._length);
    const result: T[] = [];
    const startIdx = this._length - count;
    const start = this._length < this.capacity ? 0 : this.head;
    for (let i = startIdx; i < this._length; i++) {
      result.push(this.buffer[(start + i) % this.capacity] as T);
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this._length = 0;
    this._dirty = true;
    this._cachedArray = [];
  }

  get length(): number {
    return this._length;
  }

  get isFull(): boolean {
    return this._length === this.capacity;
  }
}
