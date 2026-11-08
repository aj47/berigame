import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialNotice, walkNotice } from '../../shared/sim';
import { PersonalNotices } from './statePresentation';

// game.ts feeds every social_event insert to PersonalNotices and reads state.notices and state.player.lastWalk from it.
const me = 'a'.repeat(64), them = 'b'.repeat(64);
const hex = (h: string) => ({ toHexString: () => h });
const row = (tick: number, kind: number, text: string, to = me) => ({ tick, kind, from: hex(to), to: hex(to), text });

test('a walk notice sets state.player.lastWalk; arrivals stay out of state.notices', () => {
  const p = new PersonalNotices(me);
  assert.equal(p.lastWalk, null);
  p.record(row(5, SocialNotice.TradeRequest, 'Player-b wants to trade'));
  // Twelve arrivals in a row: lastWalk follows them, the trade request is not pushed out of the 10.
  for (let i = 0; i < 12; i++) p.record(row(10 + i, SocialNotice.Walk, walkNotice('arrived', { x: 30 + i, z: 25 }, { x: 30 + i, z: 25 })));
  assert.deepEqual(p.lastWalk, { to: { x: 41, z: 25 }, ended: 'arrived', at: { x: 41, z: 25 }, tick: 21 });
  assert.deepEqual(p.notices.map(n => n.text), ['Player-b wants to trade']);

  p.record(row(30, SocialNotice.Walk, walkNotice('no_path', { x: 172, z: 124 }, { x: 200, z: 70 })));
  assert.deepEqual(p.lastWalk, { to: { x: 172, z: 124 }, ended: 'no_path', at: { x: 200, z: 70 }, tick: 30 });
  p.record(row(31, SocialNotice.Walk, walkNotice('cancelled', { x: 90, z: 198 }, { x: 80, z: 196 }, 'harvest')));
  assert.deepEqual(p.lastWalk, { to: { x: 90, z: 198 }, ended: 'cancelled', at: { x: 80, z: 196 }, by: 'harvest', tick: 31 });
  // The short endings are notices too, in order.
  assert.deepEqual(p.notices.map(n => [n.tick, n.kind]), [[5, SocialNotice.TradeRequest], [30, SocialNotice.Walk], [31, SocialNotice.Walk]]);
});

test('only your own rows count, and other notice text never reads as a walk', () => {
  const p = new PersonalNotices(me);
  p.record(row(1, SocialNotice.Walk, 'Arrived at 3,4', them));
  p.record(row(2, SocialNotice.Info, 'Arrived at 3,4'));
  p.record(row(3, SocialNotice.Walk, 'Arrived somewhere'));
  assert.equal(p.lastWalk, null);
  assert.deepEqual(p.notices.map(n => n.tick), [2, 3]);
});
