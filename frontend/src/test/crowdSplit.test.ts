import { crowdSplit } from '../Components/3D/avatarStacks';
import { QUALITY } from '../Components/3D/renderQuality';

const crowd = (n: number) => Array.from({ length: n }, (_, i) => ({ hex: `p${String(i).padStart(4, '0')}`, x: 100 + (i % 40), z: 100 + Math.floor(i / 40), priority: false }));

describe('crowd budget', () => {
  it('draws everyone in full while under the budget', () => {
    const { full, figures } = crowdSplit(crowd(30), { x: 100, z: 100 }, 48);
    expect(full.size).toBe(30); expect(figures).toEqual([]);
  });
  it('keeps the nearest and every priority player full, the rest as figures', () => {
    const players = crowd(400);
    players[399].priority = true; // far away, but your target
    const { full, figures } = crowdSplit(players, { x: 100, z: 100 }, 48);
    expect(full.size).toBe(48);
    expect(full.has('p0399')).toBe(true);
    expect(full.has('p0000')).toBe(true);
    expect(figures.length).toBe(352);
    const farthestFull = Math.max(...players.filter((p) => full.has(p.hex) && !p.priority).map((p) => Math.max(p.x - 100, p.z - 100)));
    const nearestFigure = Math.min(...figures.map((p) => Math.max(p.x - 100, p.z - 100)));
    expect(farthestFull).toBeLessThanOrEqual(nearestFigure);
  });
  it('is stable for a still crowd and scales the budget by graphics tier', () => {
    const a = crowdSplit(crowd(200), { x: 120, z: 102 }, 24), b = crowdSplit(crowd(200).reverse(), { x: 120, z: 102 }, 24);
    expect([...a.full].sort()).toEqual([...b.full].sort());
    expect(QUALITY.low.fullAvatars).toBeLessThan(QUALITY.medium.fullAvatars);
    expect(QUALITY.medium.fullAvatars).toBeLessThan(QUALITY.high.fullAvatars);
  });
});
