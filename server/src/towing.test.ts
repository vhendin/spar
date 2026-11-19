import { describe, expect, it } from 'vitest';
import { Towing } from './towing';

const runs = (t: Towing): Record<string, string> => Object.fromEntries(t.list().runs.map((r) => [r.vehicle, r.by]));

describe('towing', () => {
  it('the puller runs the vehicle it hooks on to, until it lets go', () => {
    const t = new Towing();
    expect(t.hook('anna', 'bo')).toBe(true);
    expect(runs(t)).toEqual({ bo: 'anna' });
    expect(t.runnerOf('anna')).toBe('anna');
    expect(t.hook('anna', 'bo')).toBe(false);
    expect(t.unhook('anna')).toBe(true);
    expect(runs(t)).toEqual({});
    expect(t.unhook('anna')).toBe(false);
  });

  it('never hooks a vehicle to itself', () => {
    const t = new Towing();
    expect(t.hook('anna', 'anna')).toBe(false);
    expect(t.list().cables).toEqual([]);
  });

  it('runs a chain in one browser: the towed vehicle winching a third', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    expect(runs(t)).toEqual({ bo: 'anna', cecilia: 'anna' });
  });

  it('joining two groups, the bigger one keeps its browser', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    // David alone hooks on to Anna's group of three: Anna's browser takes him over.
    t.hook('david', 'anna');
    expect(runs(t)).toEqual({ bo: 'anna', cecilia: 'anna', david: 'anna' });
  });

  it('two lone vehicles: the one that hooked on runs both', () => {
    const t = new Towing();
    t.hook('bo', 'anna');
    expect(runs(t)).toEqual({ anna: 'bo' });
  });

  it('a group coming apart: the part with the running browser stays, a lone vehicle goes home, the rest goes to its puller', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    t.hook('cecilia', 'david');
    expect(t.runnerOf('david')).toBe('anna');
    // Anna lets go of Bo: Bo, Cecilia and David are still joined, and Bo pulls in that part.
    t.unhook('anna');
    expect(runs(t)).toEqual({ cecilia: 'bo', david: 'bo' });
    // Cecilia lets go of David: he drives himself again, Bo keeps Cecilia.
    t.unhook('cecilia');
    expect(runs(t)).toEqual({ cecilia: 'bo' });
  });

  it('freeing a vehicle takes every cable on it and from it', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    expect(t.free('bo')).toBe(true);
    expect(t.list().cables).toEqual([]);
    expect(runs(t)).toEqual({});
    expect(t.free('bo')).toBe(false);
  });

  it('a runner leaving takes the cables of the vehicles it ran', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    t.hook('david', 'erik');
    expect(t.leave('anna')).toBe(true);
    // Bo's winch was run in Anna's browser: gone with it. David and Erik carry on.
    expect(t.list().cables).toEqual([{ from: 'david', to: 'erik' }]);
    expect(runs(t)).toEqual({ erik: 'david' });
  });

  it('a paused browser runs nothing while another in the group can', () => {
    const t = new Towing();
    t.hook('anna', 'bo');
    t.hook('bo', 'cecilia');
    expect(t.pause('anna', true)).toBe(true);
    // Bo, at the head of the rest, runs the lot, Anna's vehicle too.
    expect(runs(t)).toEqual({ anna: 'bo', cecilia: 'bo' });
    // Carrying on changes nothing: Bo's browser runs more of it.
    expect(t.pause('anna', false)).toBe(false);
    expect(runs(t)).toEqual({ anna: 'bo', cecilia: 'bo' });
    // Bo pauses in turn: back to Anna's browser.
    expect(t.pause('bo', true)).toBe(true);
    expect(runs(t)).toEqual({ bo: 'anna', cecilia: 'anna' });
    // Everyone paused: it stays where it is.
    t.pause('cecilia', true);
    expect(t.pause('anna', true)).toBe(false);
    expect(runs(t)).toEqual({ bo: 'anna', cecilia: 'anna' });
    // Hooking on to a paused driver: the one hooking runs it, as ever.
    const u = new Towing();
    u.pause('bo', true);
    u.hook('anna', 'bo');
    expect(runs(u)).toEqual({ bo: 'anna' });
  });
});
