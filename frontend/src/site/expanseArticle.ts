import { DROP_BOXES, GRID_SIZE, ISLE_SIZE, LEDGER_CLERKS, NODE_KINDS, SKILLS, SPAWN_TILE, TIER_BIOMES, TIER_NODES, TIER_NODE_SEEDS, segmentDistance, tierBiomeNames } from '@sim';
import { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, EXPANSE_LANDMARKS, RIDGES, RIVERS, WAYSTONES, biomeOf, type BiomeId } from '../../../shared/sim/expanse';
import type { WikiArticle } from './wikiContent';

const location = (tile: { x: number; z: number }) => `(${tile.x}, ${tile.z})`;
const biomeName = (id: BiomeId) => BIOMES[id].name;
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const BIOME_ORDER = Object.keys(BIOMES) as BiomeId[];

/** The river a bridge crosses: the one whose course passes nearest to it. */
function riverAt(tile: { x: number; z: number }): string {
  let best = '', bestD = Infinity;
  for (const river of RIVERS) for (let i = 1; i < river.points.length; i++) {
    const d = segmentDistance(tile.x, tile.z, river.points[i - 1], river.points[i]);
    if (d < bestD) { best = river.name; bestD = d; }
  }
  return best;
}

/** Tier nodes standing in each biome, by kind, from the published seeds. */
const nodesIn = (biome: BiomeId) => {
  const counts = new Map<number, number>();
  for (const seed of TIER_NODE_SEEDS) if (biomeOf(seed) === biome) counts.set(seed.kind, (counts.get(seed.kind) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]);
};
const tiersIn = (biome: BiomeId) => TIER_BIOMES.flatMap((biomes, i) => biomes.includes(biome) ? [i + 1] : []);
const landmarksIn = (biome: BiomeId) => EXPANSE_LANDMARKS.filter(landmark => biomeOf(landmark) === biome);
const waystoneIn = (biome: BiomeId) => WAYSTONES.find(waystone => biomeOf(waystone) === biome);

const routeRows: string[][] = [
  ...CAUSEWAYS.map(c => [c.name, 'Causeway', `${biomeName(biomeOf(c.from))} ↔ ${biomeName(biomeOf(c.to))}`, `${location(c.from)} to ${location(c.to)}`, `${Math.round(Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z))} tiles long, ${Math.round(c.width * 2)} wide`]),
  ...EXPANSE_BRIDGES.map(b => [b.name, 'Bridge', `Over the ${riverAt(b)} in ${biomeName(biomeOf(b))}`, location(b), `${b.width} tiles wide`]),
  ...RIDGES.flatMap(r => r.passes.map((p, i) => [`${r.name[0].toUpperCase()}${r.name.slice(1)} pass${r.passes.length > 1 ? ` ${i + 1}` : ''}`, 'Ridge pass', `Through ${r.name} in ${biomeName(biomeOf(p))}`, location(p), `${r.passes.length === 1 ? 'The only gap' : `One of ${r.passes.length} gaps`} in the wall`])),
];

export const expanseArticle: WikiArticle = {
  slug: 'the-expanse',
  title: 'The Expanse',
  category: 'World',
  summary: 'Five mainland biomes around the original island, joined by causeways, bridges and ridge passes.',
  lead: `The world map is ${GRID_SIZE} × ${GRID_SIZE} tiles. The original island keeps its ${ISLE_SIZE} × ${ISLE_SIZE} corner, unchanged, around spawn at ${location(SPAWN_TILE)}. Five biomes surround it: ${list(BIOME_ORDER.filter(id => id !== 'isle').map(biomeName))}. Straits, rivers and rock ridges divide them, so every trip between biomes goes over a causeway, a bridge or a pass. All of the Expanse counts as Coast: a Stick gets you there, and the Coast’s combat rules apply.`,
  facts: [
    { label: 'World grid', value: `${GRID_SIZE} × ${GRID_SIZE} tiles` },
    { label: 'Original island', value: `x and z 0–${ISLE_SIZE - 1}` },
    { label: 'Biomes', value: `${BIOME_ORDER.length} including the island` },
    { label: 'Causeways', value: String(CAUSEWAYS.length) },
    { label: 'Waystones', value: String(WAYSTONES.length) },
  ],
  sections: [
    { id: 'biomes', title: 'The biomes', paragraphs: [
      'Each Long Season tier grows in its own biomes, so the higher tiers are farther down the road. Foraging nodes stand inland and Beachcombing nodes on the shore. Counts are the nodes standing in that biome.',
    ], table: { headers: ['Biome', 'What it is', 'Tiers', 'Tier nodes', 'Places'], rows: BIOME_ORDER.map(id => [
      biomeName(id),
      BIOMES[id].detail,
      tiersIn(id).map(tier => `Tier ${tier}`).join(', ') || '—',
      nodesIn(id).map(([kind, n]) => `${NODE_KINDS[kind as keyof typeof NODE_KINDS]?.name ?? kind} × ${n}`).join('; ') || '—',
      id === 'isle' ? 'Grove, Coast, Boulders, Eastreach, the southern wilds' : landmarksIn(id).map(l => `${l.name} ${location(l)}`).join('; ') || '—',
    ]) } },
    { id: 'tiers-by-biome', title: 'Where each tier grows', table: { headers: ['Tier', 'Nodes', 'Level', 'Where'], rows: [1, 2, 3, 4, 5].map(tier => {
      const nodes = TIER_NODES.filter(node => node.tier === tier);
      return [String(tier), nodes.map(node => `${node.name} (${SKILLS[node.skill].name})`).join(', '), String(nodes[0].minLevel), tier === 1 ? 'Bramblewild’s Coast' : list(tierBiomeNames(tier))];
    }) } },
    { id: 'routes', title: 'Routes between the biomes', paragraphs: [
      `Causeways are the only land between two landmasses. Three leave the original island: the King’s Causeway from the end of the harbour road into Frostpine, the Sunfall Causeway from Sunfall Bluffs into Hearthvale, and the Fenway from Mossvale into Glimmerfen. The other ${CAUSEWAYS.length - 3} join the mainland biomes to each other.`,
      'The routes form loops, so no single causeway is the only way anywhere: the island, Frostpine and Hearthvale form one ring, and the island, Hearthvale, the Dunes and Glimmerfen another. Starfall Reach has two ways in, the Ashway from the Dunes and the Emberstair from Hearthvale. Cutting one route still leaves a long walk round.',
      'Inside the biomes, rivers and ridges shape the roads. Bridges cross the Rimewater, the Hearthrun and Glimmer Water. Ridges are walls of boulders with gaps: the Spine runs across Frostpine with two passes, the Redwall crosses the Dunes with the single Redwall Gap, and the Cinder Rim guards Starfall’s northern edge with one pass where the Emberstair comes ashore.',
    ], table: { headers: ['Route', 'Kind', 'Between', 'Tiles', 'Size'], rows: routeRows } },
    { id: 'places', title: 'Places on the mainland', table: { headers: ['Place', 'Biome', 'Tile', 'Notes'], rows: EXPANSE_LANDMARKS.map(l => [l.name, biomeName(biomeOf(l)), location(l), l.detail]) } },
    { id: 'waystones', title: 'Waystones', paragraphs: [
      `${WAYSTONES.length} waystones stand in the mainland towns and camps, one in each mainland biome. When you are defeated on Bramblewild, you come back at whichever is nearest in a straight line to where you fell: one of the waystones or the Grove spawn at ${location(SPAWN_TILE)}. A tie goes to the Grove. Your dropped bag stays where you fell, so the walk back to it stays short anywhere on the map.`,
      'A waystone is not a safe ring. The usual respawn protection covers your arrival, but the safe ring exists only around the Grove spawn, and whoever defeated you may still be nearby.',
    ], table: { headers: ['Waystone', 'Biome', 'Tile'], rows: WAYSTONES.map(w => [w.name, biomeName(biomeOf(w)), location(w)]) } },
    { id: 'towns', title: 'Towns: clerks and drop boxes', paragraphs: [
      `The Island Ledger has ${LEDGER_CLERKS.length} clerks. Each takes the same commissions, so hand in at whichever is closest. Drop boxes take deposits into your vault: stand next to one and the deposit finishes a few seconds later unless a hit or a step stops it. They only take deposits; withdraw in the safe ring.`,
    ], table: { headers: ['Service', 'Tile'], rows: [
      ...LEDGER_CLERKS.map(c => [c.name, location(c)]),
      ...DROP_BOXES.map(b => [b.name, location(b)]),
    ] } },
    { id: 'getting-around', title: 'Getting around', paragraphs: [
      'Starfall Crater is the farthest place from spawn: about 290 steps, a minute and a half on foot. Kingsgate is the nearest town at about 120. A move order to any reachable tile walks the whole way. Roads are drawn on the ground and no node grows on them.',
      'The King’s Road runs on past Rimewatch to the Meadows district, which now joins the far east edge of the map when settlements are enabled.',
    ] },
  ],
  related: ['world-regions', 'coast', 'the-long-season', 'gathering', 'death-safety', 'meadows'],
  sourceFiles: ['shared/sim/expanse.ts', 'shared/sim/terrain.ts', 'shared/sim/season.ts', 'shared/sim/constants.ts', 'shared/sim/pathfinding.ts'],
};
