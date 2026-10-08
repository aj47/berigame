import { describe, expect, it } from 'vitest';
import { resolveSiteRedirect, resolveSiteRoute } from '../site/routeUtils';

describe('public site entry routes', () => {
  it.each([
    ['/', { kind: 'landing' }],
    ['/play', { kind: 'game' }],
    ['/play/', { kind: 'game' }],
    ['/agent/', { kind: 'agent' }],
    ['/admin', { kind: 'admin' }],
    ['/docs', { kind: 'wiki' }],
    ['/docs/', { kind: 'wiki' }],
    ['/docs/getting-started', { kind: 'wiki', slug: 'getting-started' }],
    ['/docs/giant%2Dberry/', { kind: 'wiki', slug: 'giant-berry' }],
    ['/missing-page', { kind: 'not-found' }],
    ['/docs/skills/foraging', { kind: 'not-found' }],
  ])('resolves %s independently of game state', (path, expected) => {
    expect(resolveSiteRoute(path as string)).toEqual(expected);
  });

  it.each(['/docs/%', '/docs/%E0%A4%A', '/docs/a%2Fb', '/docs/a%5Cb', '/docs/%00', '/docs/%2E%2E'])('safely rejects %s', path => {
    expect(resolveSiteRoute(path)).toEqual({ kind: 'not-found' });
  });

  it('keeps legacy root invites entering the game without consuming their query or hash', () => {
    const url = new URL('https://berigame.example/?join=ABCDEFGH&reconnectAttempts=2#island');
    const before = url.href;
    expect(resolveSiteRoute(url.pathname, url.search)).toEqual({ kind: 'game' });
    expect(url.href).toBe(before);
    expect(resolveSiteRoute('/play', url.search)).toEqual({ kind: 'game' });
  });

  it('does not treat unrelated queries or article links as game invitations', () => {
    expect(resolveSiteRoute('/', '?source=wiki')).toEqual({ kind: 'landing' });
    expect(resolveSiteRoute('/docs/combat', '?join=ABCDEFGH')).toEqual({ kind: 'wiki', slug: 'combat' });
    expect(resolveSiteRoute('/missing', '?join=ABCDEFGH')).toEqual({ kind: 'not-found' });
  });
});

describe('production domain routes', () => {
  it('uses the wiki domain root and clean article URLs', () => {
    expect(resolveSiteRoute('/', '', 'wiki.berigame.com')).toEqual({ kind: 'wiki' });
    expect(resolveSiteRoute('/getting-started/', '', 'wiki.berigame.com')).toEqual({ kind: 'wiki', slug: 'getting-started' });
    expect(resolveSiteRoute('/docs/crafting', '', 'wiki.berigame.com')).toEqual({ kind: 'wiki', slug: 'crafting' });
    expect(resolveSiteRoute('/crafting/ingredients', '', 'wiki.berigame.com')).toEqual({ kind: 'not-found' });
    expect(resolveSiteRoute('/%2F', '', 'wiki.berigame.com')).toEqual({ kind: 'not-found' });
  });

  it('keeps the existing beta game at its root, without changing other hosts', () => {
    expect(resolveSiteRoute('/', '', 'beta.berigame.com')).toEqual({ kind: 'game' });
    expect(resolveSiteRoute('/', '?join=ABCDEFGH', 'beta.berigame.com')).toEqual({ kind: 'game' });
    expect(resolveSiteRoute('/', '', 'berigame.com')).toEqual({ kind: 'landing' });
    expect(resolveSiteRoute('/', '', 'localhost')).toEqual({ kind: 'landing' });
    expect(resolveSiteRoute('/crafting', '', 'localhost')).toEqual({ kind: 'not-found' });
  });

  it('canonicalizes old docs links while preserving searches and section anchors', () => {
    for (const hostname of ['berigame.com', 'www.berigame.com', 'wiki.berigame.com', 'beta.berigame.com']) {
      expect(resolveSiteRedirect('/docs/', '?q=Stone+Club', '', hostname)).toBe('https://wiki.berigame.com/?q=Stone+Club');
      expect(resolveSiteRedirect('/docs/crafting/', '?recipe=stone_club', '#recipe-planner', hostname)).toBe('https://wiki.berigame.com/crafting?recipe=stone_club#recipe-planner');
    }
    expect(resolveSiteRedirect('/crafting', '', '#recipe-planner', 'wiki.berigame.com')).toBeNull();
  });

  it('sends public play, agent and legacy invite links to the existing game', () => {
    for (const hostname of ['berigame.com', 'www.berigame.com', 'wiki.berigame.com']) {
      expect(resolveSiteRedirect('/play/', '?join=ABCDEFGH', '#camp', hostname)).toBe('https://beta.berigame.com/?join=ABCDEFGH#camp');
      expect(resolveSiteRedirect('/agent', '?source=wiki', '', hostname)).toBe('https://beta.berigame.com/agent?source=wiki');
    }
    expect(resolveSiteRedirect('/', '?join=ABCDEFGH&reconnectAttempts=2', '#camp', 'berigame.com')).toBe('https://beta.berigame.com/?join=ABCDEFGH&reconnectAttempts=2#camp');
    expect(resolveSiteRedirect('/', '?join=ABCDEFGH', '', 'wiki.berigame.com')).toBeNull();
    expect(resolveSiteRedirect('/', '?join=ABCDEFGH', '', 'beta.berigame.com')).toBeNull();
    expect(resolveSiteRedirect('/agent', '', '', 'beta.berigame.com')).toBeNull();
    expect(resolveSiteRedirect('/admin', '', '', 'beta.berigame.com')).toBeNull();
    expect(resolveSiteRedirect('/admin', '', '', 'berigame.com')).toBe('https://beta.berigame.com/admin');
  });

  it('keeps arbitrary preview domains and localhost self-contained', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'preview.workers.dev', 'wiki.berigame.com.example.org']) {
      expect(resolveSiteRedirect('/docs/crafting', '', '#recipes', hostname)).toBeNull();
      expect(resolveSiteRedirect('/play', '?join=ABCDEFGH', '', hostname)).toBeNull();
    }
  });
});
