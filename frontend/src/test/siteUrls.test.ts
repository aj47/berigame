import { describe, expect, it } from 'vitest';
import { agentUrl, gameUrl, homeUrl, wikiUrl } from '../site/siteUrls';

describe('links between the website, wiki and existing game', () => {
  it('uses clean local article links on the wiki domain', () => {
    expect(wikiUrl('', 'wiki.berigame.com')).toBe('/');
    expect(wikiUrl('crafting#recipe-planner', 'wiki.berigame.com')).toBe('/crafting#recipe-planner');
    expect(wikiUrl('item-stone-club', 'wiki.berigame.com')).toBe('/item-stone-club');
    expect(homeUrl('#explore', 'wiki.berigame.com')).toBe('https://berigame.com/#explore');
    expect(gameUrl('wiki.berigame.com')).toBe('https://beta.berigame.com/');
    expect(agentUrl('wiki.berigame.com')).toBe('https://beta.berigame.com/agent');
  });

  it('sends the public website navigation to the correct domains', () => {
    expect(homeUrl('', 'berigame.com')).toBe('/');
    expect(homeUrl('#explore', 'berigame.com')).toBe('/#explore');
    expect(wikiUrl('', 'berigame.com')).toBe('https://wiki.berigame.com/');
    expect(wikiUrl('getting-started', 'berigame.com')).toBe('https://wiki.berigame.com/getting-started');
    expect(gameUrl('berigame.com')).toBe('https://beta.berigame.com/');
    expect(agentUrl('berigame.com')).toBe('https://beta.berigame.com/agent');
    expect(wikiUrl('?q=Flint', 'www.berigame.com')).toBe('https://wiki.berigame.com/?q=Flint');
  });

  it('keeps game and agent links on beta and opens the external wiki from game help', () => {
    expect(gameUrl('beta.berigame.com')).toBe('/');
    expect(agentUrl('beta.berigame.com')).toBe('/agent');
    expect(wikiUrl('', 'beta.berigame.com')).toBe('https://wiki.berigame.com/');
    expect(homeUrl('', 'beta.berigame.com')).toBe('https://berigame.com/');
  });

  it('preserves every local development path, including recipe section links', () => {
    for (const hostname of ['', 'localhost', '127.0.0.1', 'preview.workers.dev', 'berigame.com.example.org']) {
      expect(homeUrl('#explore', hostname)).toBe('/#explore');
      expect(wikiUrl('', hostname)).toBe('/docs');
      expect(wikiUrl('skills-progression#keepsakes', hostname)).toBe('/docs/skills-progression#keepsakes');
      expect(wikiUrl('?q=Flint', hostname)).toBe('/docs?q=Flint');
      expect(gameUrl(hostname)).toBe('/play');
      expect(agentUrl(hostname)).toBe('/agent');
    }
  });
});
