import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, ParkLatch } from './input';

describe('park', () => {
  it('parks on a double tap when nearly stopped, and a tap or a pedal lets it go', () => {
    const p = new ParkLatch();
    p.tap(0, 0);
    expect(p.parked).toBe(false);
    p.tap(DOUBLE_TAP_MS - 50, 0);
    expect(p.parked).toBe(true);
    p.tap(2000, 0);
    expect(p.parked).toBe(false);
    p.tap(3000, 0);
    p.tap(3100, 0);
    expect(p.parked).toBe(true);
    p.pedals(1, 0);
    expect(p.parked).toBe(false);
  });

  it('needs the taps close together, and the vehicle slow', () => {
    const p = new ParkLatch();
    p.tap(0, 0);
    p.tap(DOUBLE_TAP_MS + 50, 0);
    expect(p.parked).toBe(false);
    p.tap(5000, 15);
    p.tap(5100, 15);
    expect(p.parked).toBe(false);
  });
});
