import { describe, expect, it } from 'vitest';
import { parseWatchParams, resolvePlayer } from '../watch/watchParams';

const row = (hex: string, name: string) => ({ identity: { toHexString: () => hex }, name });

describe('parseWatchParams', () => {
  it('follows a named player, or shows the map without one', () => {
    expect(parseWatchParams('?player=Opus').mode).toBe('follow');
    expect(parseWatchParams('').mode).toBe('overview');
    expect(parseWatchParams('?mode=overview&player=Opus').mode).toBe('overview');
    expect(parseWatchParams('?mode=director').mode).toBe('director');
    expect(parseWatchParams('?mode=edit').mode).toBe('overview');
  });

  it('clamps the numbers a URL can set', () => {
    expect(parseWatchParams('?delay=45').delayMs).toBe(45_000);
    expect(parseWatchParams('?delay=-4').delayMs).toBe(0);
    expect(parseWatchParams('?delay=99999').delayMs).toBe(600_000);
    expect(parseWatchParams('?delay=soon').delayMs).toBe(0);
    expect(parseWatchParams('?fps=1000').fps).toBe(60);
    expect(parseWatchParams('?hold=1').holdMs).toBe(3000);
  });

  it('takes the world as a gateway origin only', () => {
    expect(parseWatchParams('?world=https://match.example/anything?x=1').world).toBe('https://match.example');
    expect(parseWatchParams('?world=http://127.0.0.1:3001').world).toBe('http://127.0.0.1:3001');
    expect(parseWatchParams('?world=javascript:alert(1)').world).toBeNull();
    expect(parseWatchParams('?world=nonsense').world).toBeNull();
  });

  it('keeps audio off unless asked, so sources do not play over each other', () => {
    expect(parseWatchParams('').audio).toBe(false);
    expect(parseWatchParams('?audio=1').audio).toBe(true);
  });
});

describe('resolvePlayer', () => {
  const hex = 'ab'.repeat(32);
  it('takes an identity without needing its row', () => {
    expect(resolvePlayer(hex.toUpperCase(), [])).toBe(hex);
    expect(resolvePlayer(`0x${hex}`, [])).toBe(hex);
  });
  it('matches a whole name in any case, and nothing else', () => {
    expect(resolvePlayer('opus', [row(hex, 'Opus')])).toBe(hex);
    expect(resolvePlayer('Op', [row(hex, 'Opus')])).toBeNull();
  });
});
