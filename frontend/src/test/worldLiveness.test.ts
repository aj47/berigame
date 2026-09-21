import { describe, expect, it } from 'vitest';
import { WorldLiveness } from '../spacetime/worldLiveness';
const live = () => { const value = new WorldLiveness(); value.setConnected(true, 0); value.observeTick(10, 0); return value; };
describe('world update liveness policy', () => {
  it('allows normal cadence but warns at six seconds without an advancing tick', () => {
    const h=live(); expect(h.check(5999)).toBe(false); expect(h.check(6000)).toBe(true);
    h.observeTick(11,6001); expect(h.check(6001)).toBe(false);
  });
  it('duplicate and backwards rows cannot disguise a stalled stream', () => {
    const h=live(); h.observeTick(10,5000); h.observeTick(9,5500); expect(h.check(6000)).toBe(true);
  });
  it('offline warns immediately and online alone cannot unlock controls', () => {
    const h=live();h.setOnline(false);expect(h.stalled).toBe(true);
    h.setOnline(true);expect(h.check(100)).toBe(true);h.observeTick(10,200);expect(h.stalled).toBe(true);
    h.observeTick(11,300);expect(h.stalled).toBe(false);
  });
  it('incoming data does not declare recovery while the browser still reports offline', () => {
    const h=live();h.setOnline(false);h.observeTick(11,200);expect(h.stalled).toBe(true);
    h.setOnline(true);expect(h.stalled).toBe(true);h.observeTick(12,400);expect(h.stalled).toBe(false);
  });
  it('hidden elapsed time is not failure and foreground gets a two-second fresh-tick grace', () => {
    const h=live();h.setVisible(false,100);expect(h.check(60000)).toBe(false);
    h.setVisible(true,60000);expect(h.check(61999)).toBe(false);expect(h.check(62000)).toBe(true);
  });
  it('a fresh tick during resume grace avoids a false interruption', () => {
    const h=live();h.setVisible(false,100);h.setVisible(true,60000);h.observeTick(110,61000);expect(h.check(62000)).toBe(false);
  });
  it('hiding/revealing an already stalled connection does not falsely recover it', () => {
    const h=live();h.check(6000);h.setVisible(false,6100);h.setVisible(true,10000);expect(h.check(10000)).toBe(true);
  });
  it('a new transport requires a world row, allowing a freshly reset world tick', () => {
    const h=live();h.check(6000);h.setConnected(false,6100);h.setConnected(true,6200);expect(h.stalled).toBe(true);
    h.observeTick(0,6300);expect(h.stalled).toBe(false);expect(h.check(12300)).toBe(true);
  });
});
