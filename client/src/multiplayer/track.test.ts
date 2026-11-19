import { describe, expect, it } from 'vitest';
import { isClientMessage, isServerMessage } from '@spar/shared/validate';
import type { VehicleSnapshot } from '@spar/shared';
import { AHEAD, DELAY, forwardSpeed, takeSnapshot, Track } from './track';

/** A vehicle heading east (+x) at `speed`, seen at sender time `t`. */
const at = (t: number, x: number, extra: Partial<VehicleSnapshot> = {}): VehicleSnapshot => ({
  region: 'demo', vehicle: 'tgb11', jump: 0, t, paused: false,
  p: [x, 10, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], v: [20, 0, 0],
  wheels: [[0, 0.3], [0, 0.3], [0, 0.3], [0, 0.3]], lights: false, braking: false,
  ...extra,
});

describe('Track', () => {
  it('draws the vehicle a little in the past, blended between snapshots', () => {
    const track = new Track();
    // The sender's clock runs 5000 ms behind ours; each snapshot takes 10 ms to come.
    for (let k = 0; k <= 4; k++) track.push(at(k * 50, k), 5010 + k * 50);
    // Drawn DELAY behind, at sender time 175: halfway between snapshots 3 and 4.
    const pose = track.pose(5010 + 175 + DELAY)!;
    expect(pose.p[0]).toBeCloseTo(3.5, 6);
    expect(pose.speed).toBeCloseTo(20, 6); // facing east, going east
  });

  it('carries it on at its speed for a moment, then holds it', () => {
    const track = new Track();
    track.push(at(0, 0), 1000);
    track.push(at(50, 1), 1050);
    expect(track.pose(1050 + DELAY + 100)!.p[0]).toBeCloseTo(1 + 20 * 0.1, 6);
    const held = track.pose(1050 + DELAY + 5000)!.p[0];
    expect(held).toBeCloseTo(1 + (20 * AHEAD) / 1000, 6);
    // A paused vehicle is not carried on.
    track.push(at(100, 2, { paused: true }), 1100);
    expect(track.pose(1100 + DELAY + 200)!.p[0]).toBe(2);
  });

  it('jumps to a new place instead of sliding there, and ignores late snapshots', () => {
    const track = new Track();
    track.push(at(0, 0), 1000);
    track.push(at(50, 1), 1050);
    track.push(at(40, 99), 1060); // older than the newest
    expect(track.latest!.p[0]).toBe(1);
    track.push(at(60, 500, { jump: 1 }), 1070);
    expect(track.pose(1070)!.p[0]).toBe(500);
  });

  it('turns the short way between rotations', () => {
    const track = new Track();
    track.push(at(0, 0, { q: [0, 0, 0, 1] }), 1000);
    track.push(at(50, 0, { q: [0, 0, 0, -1] }), 1050); // the same rotation, written the other way
    const q = track.pose(1025 + DELAY)!.q;
    expect(Math.abs(q[3])).toBeCloseTo(1, 6);
  });
});

describe('takeSnapshot', () => {
  it('makes a message both sides of the server accept', () => {
    const sim = {
      def: { name: 'tgb11' },
      body: {
        translation: () => ({ x: 1.23456, y: 2, z: 3 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
        linvel: () => ({ x: 0, y: 0, z: 5.555 }),
      },
      wheels: Array.from({ length: 6 }, () => ({ steer: 0.12345, suspension: 0.3 })),
    };
    const vehicle = takeSnapshot(sim, { region: 'demo', jump: 3, t: 123.456, paused: false, lights: true, braking: false });
    expect(vehicle.p[0]).toBe(1.235);
    expect(vehicle.wheels).toHaveLength(6);
    expect(forwardSpeed(vehicle.q, vehicle.v)).toBeCloseTo(5.56, 6);
    expect(isClientMessage({ type: 'state', vehicle })).toBe(true);
    expect(isServerMessage({ type: 'state', id: 'p1', vehicle })).toBe(true);
    expect(JSON.stringify({ type: 'state', vehicle }).length).toBeLessThan(400);
  });
});
