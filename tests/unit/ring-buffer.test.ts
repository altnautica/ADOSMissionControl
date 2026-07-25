import { describe, it, expect } from 'vitest';
import { RingBuffer } from '@/lib/ring-buffer';

describe('RingBuffer', () => {
  it('constructor creates empty buffer with given capacity', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.capacity).toBe(5);
    expect(rb.length).toBe(0);
    expect(rb.isFull).toBe(false);
  });

  it('push() adds items and length increments', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    expect(rb.length).toBe(1);
    rb.push(20);
    expect(rb.length).toBe(2);
  });

  it('push() overwrites oldest when full (capacity wrap)', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.isFull).toBe(true);
    expect(rb.length).toBe(3);

    rb.push(4); // overwrites 1
    expect(rb.length).toBe(3);
    expect(rb.get(0)).toBe(2); // oldest is now 2
    expect(rb.get(1)).toBe(3);
    expect(rb.get(2)).toBe(4); // newest
  });

  it('get(0) returns oldest item', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    expect(rb.get(0)).toBe(10);
  });

  it('get(length-1) returns newest', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    expect(rb.get(rb.length - 1)).toBe(30);
  });

  it('get() returns undefined for out-of-range indices', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    expect(rb.get(-1)).toBeUndefined();
    expect(rb.get(2)).toBeUndefined();
    expect(rb.get(100)).toBeUndefined();
  });

  it('latest() returns most recently pushed item', () => {
    const rb = new RingBuffer<string>(3);
    rb.push('a');
    rb.push('b');
    rb.push('c');
    expect(rb.latest()).toBe('c');
    rb.push('d');
    expect(rb.latest()).toBe('d');
  });

  it('latest() returns undefined when empty', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.latest()).toBeUndefined();
  });

  it('toArray() returns items oldest-first', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    expect(rb.toArray()).toEqual([10, 20, 30]);
  });

  it('toArray() returns correct order after wrapping', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // wraps: [4, 2, 3] internally, but logical order is [2, 3, 4]
    rb.push(5); // wraps: [4, 5, 3] internally, logical [3, 4, 5]
    expect(rb.toArray()).toEqual([3, 4, 5]);
  });

  it('toArray() returns empty array when empty', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.toArray()).toEqual([]);
  });

  // Callers that only want the oldest entry (a trail home point) index the
  // ring directly instead of copying the whole buffer out. That substitution
  // is only safe while these two agree, empty and wrapped included.
  it('get(0) matches toArray()[0] when empty, partial, full and wrapped', () => {
    for (const pushes of [0, 1, 3, 5, 6, 12]) {
      const rb = new RingBuffer<number>(5);
      for (let i = 0; i < pushes; i++) rb.push(i);
      expect(rb.get(0)).toBe(rb.toArray()[0]);
    }
  });

  it('last(n) returns last n items', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4);
    rb.push(5);
    expect(rb.last(3)).toEqual([3, 4, 5]);
  });

  it('last(n) returns all items when n > length', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    rb.push(20);
    expect(rb.last(10)).toEqual([10, 20]);
  });

  it('clear() resets everything', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.isFull).toBe(false);
    expect(rb.latest()).toBeUndefined();
    expect(rb.toArray()).toEqual([]);
  });

  it('isFull returns true at capacity', () => {
    const rb = new RingBuffer<number>(2);
    expect(rb.isFull).toBe(false);
    rb.push(1);
    expect(rb.isFull).toBe(false);
    rb.push(2);
    expect(rb.isFull).toBe(true);
  });

  it('capacity of 1 works correctly', () => {
    const rb = new RingBuffer<string>(1);
    expect(rb.length).toBe(0);
    rb.push('a');
    expect(rb.length).toBe(1);
    expect(rb.isFull).toBe(true);
    expect(rb.latest()).toBe('a');
    expect(rb.toArray()).toEqual(['a']);

    rb.push('b'); // overwrites 'a'
    expect(rb.length).toBe(1);
    expect(rb.latest()).toBe('b');
    expect(rb.get(0)).toBe('b');
    expect(rb.toArray()).toEqual(['b']);
  });
});
