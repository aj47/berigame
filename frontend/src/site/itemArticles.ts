import {
  EAT_COOLDOWN_TICKS, EAT_SWING_DELAY_TICKS, GARDEN_CROPS, ITEM_DEFS,
  NODE_KINDS, NODE_SEEDS, RAID_MIN_CONTRIBUTION, RAID_REWARD, RECIPES,
  SWING_INTERVAL_TICKS, TICK_MS, TREE_SEEDS, harvestXp,
} from '@sim';
import type { ItemDef, Recipe } from '@sim';
import { DISCIPLINES, FRONTIER, FRONTIER_RECIPES, MATERIALS, PIECES, REGIONS, RESOURCE_PATCHES } from '../../../shared/sim/frontier/catalog';
import type { WikiArticle, WikiSection } from './wikiContent';

export const itemArticleSlug = (itemId: string) => `item-${itemId.replaceAll('_', '-')}`;
const seconds = (ticks: number) => `${Number((ticks * TICK_MS / 1000).toFixed(1))} seconds`;
const itemName = (id: string) => ITEM_DEFS[id]?.name ?? id;
const ingredients = (recipe: Recipe) => recipe.inputs.map(input => `${input.quantity} × ${itemName(input.itemId)}`).join(' + ');

interface ItemNotes {
  summary: string;
  lead: string;
  source: string;
  sections: WikiSection[];
  related: string[];
  sourceFiles?: string[];
}

const notes: Record<string, ItemNotes> = {
  berry_blueberry: {
    summary: 'A five-HP berry from the eastern Grove, also grown in your garden.',
    lead: 'Blueberries are edible berries that restore 5 HP. The wild tree stands just east of the starting safe ring, making it a convenient source of food before exploring the island. They can also be planted for a later harvest.',
    source: 'Grove tree · Coast thickets · personal garden',
    sections: [{ id: 'practical-uses', title: 'When to use blueberries', paragraphs: [
      'A blueberry restores more health per bite than a strawberry or greenberry. A new character starts at 20 of 30 HP, so two blueberries can restore the missing 10 HP, with the normal eating cooldown between bites.',
      'Blueberries have no ingredient role in the current crafting recipes. Berry Mash specifically requires greenberries and a strawberry; blueberries cannot substitute. Keeping them as food or planting them are the direct uses available.',
    ] }],
    related: ['garden', 'gathering', 'item-berry-goldberry', 'item-berry-mash', 'inventory-items'],
  },
  berry_strawberry: {
    summary: 'Three-HP food for Berry Mash and settlement Travel rations.',
    lead: 'Strawberries restore 3 HP and grow on two wild trees in the Grove. One Strawberry and two Greenberries make Berry Mash. When settlements are enabled, Strawberries also grow at a Meadows patch and combine with Carrots into Travel rations.',
    source: 'Two Grove trees · Coast thickets · personal garden',
    sections: [{ id: 'practical-uses', title: 'Eat, plant or make mash', paragraphs: [
      'Use a strawberry for a small top-up, or combine it with two greenberries when you want a larger single bite. Those ingredients restore 7 HP when eaten separately, exactly the same as the resulting mash. Crafting changes how quickly you can consume that healing and awards Crafting XP; it does not create extra HP.',
      'Both strawberry trees give the same item and Foraging XP. If one is busy or regrowing, the other is an alternative. Planting a strawberry consumes it immediately, so reserve food for your next journey before filling your garden.',
    ] }],
    related: ['item-berry-mash', 'item-berry-greenberry', 'item-travel-rations', 'frontier-materials-crafting', 'garden', 'gathering'],
  },
  berry_greenberry: {
    summary: 'Food, garden crops, expedition bait and settlement Taming feed.',
    lead: 'Greenberries restore 2 HP, the smallest heal of the island’s food items. Their other uses make them valuable expedition supplies: they can bribe Pip, distract the pursuing Giant or become Berry Mash.',
    source: 'Two Grove trees · Coast thickets · personal garden',
    sections: [{ id: 'expedition-uses', title: 'Expedition uses', paragraphs: [
      'Bribing Pip consumes one greenberry. Stand within three tiles of him during an active hauling expedition; the bribe leaves the cargo alone for 30 seconds. Equipping Favourite snack extends this to 90 seconds.',
      'Ordinary bait consumes one greenberry and leaves a scent at your position for 15 seconds. Put down any cargo you are carrying before preparing it. With Scent decoy equipped, bait instead consumes one driftwood and lasts 30 seconds.',
      'Keep a few greenberries in reserve before making mash or planting. Two greenberries and one strawberry make a 7-HP meal, but those consumed berries can no longer be used for a bribe or bait.',
      'When settlements are enabled, two Greenberries and one Plant fibre make two Taming feed before Building bonuses. Greenberries are also accepted in repeatable supply orders: deliver six for 10 coins, within your daily order allowance.',
    ] }],
    related: ['expeditions', 'wildlife-companions', 'item-taming-feed', 'coins-quests', 'item-berry-mash', 'garden'],
    sourceFiles: ['shared/sim/adventure.ts', 'spacetimedb/src/reducers/adventure.ts'],
  },
  berry_goldberry: {
    summary: 'The strongest single-bite heal, earned from the Grove and expeditions.',
    lead: 'Goldberries restore 10 HP per bite, more than any other current food. There is one wild Goldberry tree in the Grove. Garden harvests and successful giant berry expeditions provide additional ways to obtain them.',
    source: 'Grove tree · Coast thickets · garden · expeditions',
    sections: [{ id: 'expedition-rewards', title: 'Expedition rewards and hidden cache', paragraphs: [
      'A delivery normally awards four Goldberries per qualifying member; a feast adds two bonus Goldberries. Giant fruit starts cargo at six, and a completed workshop adds one more. Splitting cargo and first hiring Moss each reduce cargo value by one unless Berry basket or Porter pact prevents that cost.',
      'Remain in the expedition until completion and earn contribution credit by an action such as carrying, hiding or delivering cargo. Simply joining or tracking the hidden cache does not earn completion credit.',
      'Read tracks unlocks a hidden seed cache at (14, 15). With the technique equipped, stand within two tiles of the cache and track it during hauling to receive one goldberry and 25 Exploring XP. Each character can claim that cache once per expedition.',
      'Enabled settlement worlds have separate region caches. With Exploration active at level 2, survey within three tiles of (118, 112) in the Meadows, Reedwake or Cinder Shoal for one Goldberry and 25 Exploration XP, once per region per character.',
    ] }, { id: 'practical-uses', title: 'Use the full heal', paragraphs: [
      'A goldberry gives its full 10 HP only when at least that much health is missing. Healing stops at your maximum HP, so any excess is lost. Keep one accessible before a dangerous trip.',
      'The wild tree always takes three seconds to harvest: Foraging levels do not shorten this tree’s gather time. It has the same Foraging XP reward as ordinary berry trees.',
    ] }],
    related: ['expeditions', 'techniques', 'garden', 'combat', 'item-berry-mash'],
    sourceFiles: ['shared/sim/adventure.ts', 'spacetimedb/src/reducers/adventure.ts', 'spacetimedb/src/lib/adventure.ts'],
  },
  stick: {
    summary: 'Your first weapon and the permanent-use key through the brambles.',
    lead: 'The Stick is a 6-damage weapon and the item needed to cross outward from the Grove through the brambles. Carrying it opens the route; wielding it changes your melee damage. Each Stick occupies its own inventory slot.',
    source: 'Wild berry-tree harvests',
    sections: [{ id: 'obtaining', title: 'Obtaining your first Stick', paragraphs: [
      'Your first Stick is guaranteed by a completed wild berry-tree harvest once you reach Foraging level 2. A fresh character reaches the 25 XP threshold on the fourth harvest, which brings the total to 32 XP. The level gained by that harvest counts immediately.',
      'After claiming the first Stick, each eligible wild berry-tree harvest has a 25% chance to award another. Garden harvests, driftwood piles, tide rocks and obsidian outcrops do not roll for Sticks. A spare can be gifted or traded to another adventurer.',
      'Finding or picking up a Stick unlocks the Straw Hat keepsake. It also shortens any remaining first-spawn protection to six seconds, so take a moment to arrange your quick slots before leaving safety.',
    ] }, { id: 'area-access', title: 'Bramble access', paragraphs: [
      'Keep a Stick anywhere in your bag to cross outward through the brambles. Crossing does not consume it, and it does not need to be wielded. A Stone Club or Flint Knife cannot replace it for this crossing.',
      'The return trip from the Coast into the Grove is allowed without a Stick. Giving away or losing your last one therefore allows a return, but stops your next outward trip until you obtain another. Ordinary death drops it with the rest of your bag.',
    ] }],
    related: ['gathering', 'coast', 'item-stone-club', 'combat', 'death-safety'],
    sourceFiles: ['shared/sim/adventure.ts', 'shared/sim/skills.ts', 'shared/sim/areas.ts', 'spacetimedb/src/reducers/tick.ts'],
  },
  driftwood: {
    summary: 'Coastal timber for weapons, a crown, decoys and the shared workshop.',
    lead: 'Driftwood is a stackable material gathered from four Coast piles. It combines with flint to make equipment and can be spent on expedition distractions or the shared camp workshop.',
    source: 'Four Coast driftwood piles',
    sections: [{ id: 'practical-uses', title: 'Planning your supplies', paragraphs: [
      'Bring a Stick for the outward trip through the brambles. One driftwood and two Flint Shards make a Stone Club at Crafting level 1, opening the next region. Save that first piece if reaching the Boulders is your immediate goal.',
      'With Scent decoy equipped, preparing expedition bait consumes one driftwood instead of a greenberry and distracts the Giant for 30 seconds. The scent stays where you prepared it; use that time to move the cargo away.',
      'At the gardener camp (22, 18), each contribution consumes one driftwood and awards 20 Building XP. The shared workshop needs 20 driftwood and 10 obsidian in total. Once both targets are met, newly started expeditions gain one cargo value. Completed material targets stop accepting donations.',
    ] }],
    related: ['item-stone-club', 'item-flint', 'item-obsidian', 'expeditions', 'techniques'],
    sourceFiles: ['shared/sim/adventure.ts', 'spacetimedb/src/reducers/adventure.ts'],
  },
  flint: {
    summary: 'Tide-rock shards used in every current coastal equipment recipe.',
    lead: 'Flint Shards are stackable crafting materials from the Coast’s four tide rocks. They combine with driftwood to make a Stone Club, Flint Knife or the cosmetic Driftwood Crown.',
    source: 'Four Coast tide rocks',
    sections: [{ id: 'practical-uses', title: 'Which recipe to make first', paragraphs: [
      'The Stone Club costs two shards and one driftwood. It is available at Crafting level 1, deals 8 damage and serves as the Boulders route key. Crafting one awards 40 XP, enough to reach Crafting level 2 from zero XP.',
      'At level 2, one shard and one driftwood make a Flint Knife. Its 6 damage matches a Stick, and it opens neither barrier. At level 5, one shard and three driftwood unlock the Driftwood Crown, a keepsake that gives no combat bonus.',
      'Bring a Stick to reach the Coast. Every tide rock yields one shard per completed harvest. Because regrowth takes longer than gathering, moving to another available rock can reduce waiting. Flint is not accepted as a workshop contribution.',
    ] }],
    related: ['coast', 'item-driftwood', 'item-stone-club', 'item-flint-knife', 'crafting'],
    sourceFiles: ['shared/sim/areas.ts', 'spacetimedb/src/reducers/adventure.ts'],
  },
  stone_club: {
    summary: 'An eight-damage weapon and your entry key to the Boulders.',
    lead: 'The Stone Club deals 8 damage per melee swing and opens outward crossings into the Boulders. It is made from one driftwood and two Flint Shards, with no workbench or Crafting level beyond the starting level required.',
    source: 'Crafting · level 1',
    sections: [{ id: 'obtaining', title: 'Making your first club', paragraphs: [
      'First obtain a Stick to cross the Grove’s brambles. Gather one driftwood from a Coast pile and two flint from tide rocks, then choose Stone Club in the crafting panel. Crafting awards 40 XP, which also reaches Crafting level 2 from zero XP.',
      'Crafting removes the ingredients before placing the club, so emptying an ingredient stack can free its slot. Stop fighting and put down any giant berry cargo first. If no slot remains after consuming the materials, the club drops at your position, where others can pick it up.',
    ] }, { id: 'area-access', title: 'Boulders access', paragraphs: [
      'Keep the club in your bag or wield it when crossing outward over the boulder line. It is not consumed. The suggested route target is (51, 51); beyond it are obsidian outcrops and the scheduled raid Giant.',
      'You can return from the Boulders without a club, but need another for a later outward crossing. A club does not open the Grove’s brambles, so keep your Stick too. Gifting or trading away your last club can interrupt later trips.',
    ] }],
    related: ['item-driftwood', 'item-flint', 'item-stick', 'boulders', 'giant-raids'],
    sourceFiles: ['shared/sim/areas.ts', 'shared/sim/skills.ts', 'spacetimedb/src/reducers/craft.ts'],
  },
  obsidian: {
    summary: 'A rare Boulders resource and raid reward for the shared workshop.',
    lead: 'Obsidian is a stackable material gathered from two Boulders outcrops or earned by defeating the raid Giant. Its current use is contributing to the permanent workshop at the gardener camp.',
    source: 'Boulders outcrops · Giant raids',
    sections: [{ id: 'raid-reward', title: 'Giant raid reward', paragraphs: [
      `Each online contributor who deals at least ${RAID_MIN_CONTRIBUTION} damage during a successful raid receives ${RAID_REWARD.quantity} obsidian and unlocks the Giant’s Tooth keepsake. Three full Stone Club hits meet that damage threshold. The reward is equal for every qualifying player; extra damage does not increase the quantity.`,
      'The Giant must be defeated within its raid window, and you must be online when the reward is granted. Bring a Stone Club for entry to the Boulders and food for the encounter. The outcrops provide an alternative that does not require completing a raid.',
    ] }, { id: 'workshop', title: 'Building the shared workshop', paragraphs: [
      'Contribute within four tiles of the gardener camp at (22, 18). Each action consumes one obsidian and awards 20 Building XP. The workshop’s shared target is 10 obsidian plus 20 driftwood; donations stop once that material’s target is complete.',
      'When both targets are complete, newly started expeditions gain one cargo value. Obsidian also goes into Spire Keys (three each, with one gleamshell) and the Shard Circlet keepsake (two). It cannot be wielded and does not heal.',
    ] }],
    related: ['boulders', 'giant-raids', 'item-spire-key', 'item-stone-club', 'item-driftwood', 'expeditions'],
    sourceFiles: ['shared/sim/raid.ts', 'spacetimedb/src/reducers/tick.ts', 'spacetimedb/src/reducers/adventure.ts'],
  },
  gleamshell: {
    summary: "Clatterhorn's iridescent shell plates: the beetle's reward and half of every Spire key.",
    lead: "Gleamshell is a stackable material shed by Clatterhorn, the stag beetle of Clatterhorn's Glade on the southern Coast. Every qualifying helper at a defeat receives two. Its use is crafting Spire keys with obsidian.",
    source: 'Clatterhorn defeats',
    sections: [{ id: 'earning', title: 'Earning gleamshell', paragraphs: [
      'Clatterhorn rewards every online helper who dealt at least 16 damage and landed a swing in the last 100 ticks (about a minute) before its defeat: 2 gleamshell, 2 goldberries and 40 Fighting XP each. Equal shares; extra damage adds nothing.',
      'The glade is Coast, so a Stick is enough to reach it. Rewards that do not fit in your bag drop at your feet.',
    ] }, { id: 'spire-keys', title: 'Spire keys', paragraphs: [
      'One gleamshell and three obsidian make a Spire Key at Crafting level 1. Each member of a Sunken Spire party spends one key when the party starts, so a regular party needs a steady supply of both.',
    ] }],
    related: ['clatterhorn', 'item-spire-key', 'item-obsidian', 'coast', 'crafting'],
  },
  spire_key: {
    summary: "One descent into the Sunken Spire, spent when your party starts.",
    lead: 'A Spire Key opens the stair under the Sunken Spire Gate on the Boulders\' east cliff for one descent. Every member of a party needs one in the bag; each key is consumed when the leader starts the run.',
    source: 'Crafting · level 1',
    sections: [{ id: 'opens', title: 'What it opens', paragraphs: [
      'Opens: the Sunken Spire, consumed per member at the start. A party of one to four forms at the gate, (62, 45), which needs a Stone Club to reach. Keys are kept if the party breaks up in the lobby, and refunded when a run is closed or abandoned before it can finish.',
      'Keys stack to 10 per slot. They are ordinary bag items: you can trade them, and they drop with the rest of your bag if you die on the overworld. A knockout inside the Spire never touches your bag.',
    ] }],
    related: ['sunken-spire', 'item-gleamshell', 'item-obsidian', 'item-prism-shard', 'boulders', 'crafting'],
  },
  prism_shard: {
    summary: 'A splinter of the Shardmother, earned by clearing the Sunken Spire.',
    lead: 'Prism Shards are a stackable material. Every qualifying member of a party that clears the Sunken Spire receives one, together with four goldberries and 100 Fighting XP. Five shards and two obsidian make the Shard Circlet keepsake.',
    source: 'Sunken Spire clears',
    sections: [{ id: 'earning', title: 'Earning prism shards', paragraphs: [
      'At a clear, members who caught at least three stars and are online receive the reward at the gate\'s exit tile. Members who left the run, or who were offline at the clear, receive nothing.',
    ] }, { id: 'circlet', title: 'The Shard Circlet', paragraphs: [
      'At Crafting level 10, five Prism Shards and two obsidian make the Shard Circlet, a head keepsake. Like every keepsake it is cosmetic and gives no combat bonus.',
    ] }],
    related: ['sunken-spire', 'item-spire-key', 'item-obsidian', 'crafting'],
  },
  berry_mash: {
    summary: 'Seven HP in one bite, crafted from berries or split from expedition cargo.',
    lead: 'Berry Mash is a stackable prepared meal that restores 7 HP. It can be crafted at level 1 or obtained by splitting a giant berry during an expedition. It is food, not a crop: you cannot plant it in the garden.',
    source: 'Crafting · expedition split',
    sections: [{ id: 'expedition-split', title: 'Splitting expedition cargo', paragraphs: [
      'During hauling, stand within two tiles of the giant berry and choose Split to receive two portions of mash. Cargo can be split once per expedition. If another player or Moss is carrying it, ask for it to be put down first.',
      'Splitting normally reduces cargo value by one, to a minimum of one. Having Berry basket equipped preserves its value. The two meals are immediate supplies you can eat or share; choose whether that food is worth the possible reduction in everyone’s eventual goldberry reward.',
    ] }, { id: 'practical-uses', title: 'Why prepare mash?', paragraphs: [
      'Two greenberries restore 4 HP and a strawberry restores 3 HP, so crafting them into mash preserves the total 7 HP. The advantage is consuming that healing in one bite instead of three, using one eating cooldown and one attack delay.',
      'Crafting also awards 15 Crafting XP. Save greenberries if you still need them for expedition bait or Pip’s bribe. A Goldberry remains the stronger individual heal at 10 HP, but it is not required for this recipe.',
    ] }],
    related: ['item-berry-greenberry', 'item-berry-strawberry', 'item-berry-goldberry', 'expeditions', 'crafting'],
    sourceFiles: ['shared/sim/adventure.ts', 'spacetimedb/src/reducers/adventure.ts'],
  },
  flint_knife: {
    summary: 'A crafted six-damage weapon unlocked at Crafting level 2.',
    lead: 'The Flint Knife is a one-slot melee weapon made from one driftwood and one Flint Shard. It deals 6 damage per swing, the same as a Stick, and requires Crafting level 2 to make.',
    source: 'Crafting · level 2',
    sections: [{ id: 'obtaining', title: 'Unlocking and crafting', paragraphs: [
      'Crafting level 2 requires 25 XP. A first Stone Club awards 40 XP and reaches that level immediately from zero; two Berry Mash crafts award 30 XP and also reach it. Once unlocked, each knife costs one driftwood and one flint and awards 25 Crafting XP.',
      'Use the crafting panel while alive, outside active fighting and with giant berry cargo put down. Materials are consumed before placing the knife, so an emptied ingredient stack can free its slot. If the knife still cannot fit, it drops onto the ground.',
    ] }, { id: 'practical-uses', title: 'Choosing your equipment', paragraphs: [
      'The knife costs one less Flint Shard than a Stone Club, but the club deals 8 damage and unlocks the Boulders. A knife cannot open either the brambles or the boulder line: keep a Stick and Stone Club for travel even if you prefer to wield the knife.',
      'No current recipe uses the knife as a tool or ingredient. Equipping it does not speed up gathering, change garden yields or add a separate attack type. Its current role is an alternative weapon that can be traded or gifted.',
    ] }],
    related: ['item-driftwood', 'item-flint', 'item-stick', 'item-stone-club', 'crafting'],
    sourceFiles: ['shared/sim/areas.ts', 'shared/sim/skills.ts', 'spacetimedb/src/reducers/craft.ts'],
  },
};

const frontierUses: Record<string, string> = {
  timber: `Chop a settlement tree for ${FRONTIER.gatherDuration / 1000} seconds to receive Timber, then wait ${FRONTIER.timberRegrow / 1000} seconds for the stump to regrow. Carrying an Axe increases the yield from one to two. Timber makes tools, Planks and building pieces.`,
  axe: 'Keep an Axe in your bag to receive two Timber when a settlement tree-chopping action completes.',
  pick: 'With Might active at level 10, carrying a Pick doubles Stone and Iron ore gathered from resource patches.',
  hammer: 'Craft a Hammer to complete the steward’s Tools of the trade quest and progress towards a land deed.',
  watering_can: 'Carry a Watering can when planting carrots to shorten growth from two hours to ninety minutes.',
  taming_feed: 'Observe a tameable creature, then offer Taming feed nearby. Befriending normally takes two feedings; active Beastcraft level 5 reduces this to one.',
  travel_rations: 'Travel rations restore 8 base HP per portion. Eat from Bag & storage or store them as boat provisions; sailing does not automatically consume them.',
  skiff_hull: 'Combine one Skiff hull and one Sail at a harbour to launch your own skiff.',
  sail: 'Combine one Sail and one Skiff hull at a harbour to launch your own skiff.',
  harness: 'With Beastcraft active at level 2, spend a Creature harness to train a companion. A trained Reedhorn gains six cargo slots.',
  carrot: 'Carrots restore 3 HP and make Travel rations. A planter yields three carrots, or four with Cultivation active at level 2.',
  carrot_seed: 'Plant a Carrot seed in an empty planter on a plot you can build on. Growth takes two hours, or ninety minutes with a Watering can in your bag. A trained Burrowbun can also find seeds.',
  iron_club: 'The Iron club deals 9 base damage per swing. Choose Equip in the settlement bag to use it; it does not replace the Stick or Stone Club as a route key.',
  padded_vest: 'Choose Equip in the settlement bag to gain 3 maximum HP while you carry the Padded vest. Total maximum health is capped at 36.',
  reeds: 'Reeds are gathered in Reedwake. Gathering them awards Cultivation XP; they have no current crafting or building recipe.',
  resin: 'Resin is gathered in Reedwake. Gathering it awards Exploration XP; it has no current crafting or building recipe.',
};

function frontierNotes(item: ItemDef): ItemNotes {
  const patches = RESOURCE_PATCHES.filter(patch => patch.item === item.id);
  const recipes = FRONTIER_RECIPES.filter(recipe => recipe.output === item.id || item.id in recipe.inputs);
  const making = recipes.find(recipe => recipe.output === item.id);
  const pieces = Object.values(PIECES).filter(piece => item.id in piece.cost);
  const uses = recipes.filter(recipe => recipe.output !== item.id).map(recipe => itemName(recipe.output));
  const summary = frontierUses[item.id] ?? (uses.length
    ? `${item.name} is used to craft ${uses.join(', ')}.`
    : `${item.name} is a settlement building material.`);
  const sections: WikiSection[] = [{ id: 'settlement-use', title: 'Settlement use', paragraphs: [summary] }];
  if (patches.length) sections.push({
    id: 'resource-patches', title: 'Resource patches',
    paragraphs: [`Gather within two tiles and wait for the action to finish. The base duration is ${FRONTIER.gatherDuration / 1000} seconds; qualifying plants take 2.4 seconds with Cultivation active at level 5. Resources are shared, and an interrupted action gives no items or XP.`],
    table: { headers: ['Region', 'Tile'], rows: patches.map(patch => [REGIONS[patch.region].name, `(${patch.x}, ${patch.z})`]) },
  });
  if (recipes.length) sections.push({
    id: 'settlement-recipes', title: 'Settlement recipes',
    paragraphs: ['These are base quantities. Active Building perks can increase batch output or reduce ingredients. Workbench, kiln and cooking recipes also work at the public Meadows workshop.'],
    table: {
      headers: ['Result', 'Ingredients', 'Station', 'Active discipline'],
      rows: recipes.map(recipe => [
        `${recipe.quantity} × ${itemName(recipe.output)}`,
        Object.entries(recipe.inputs).map(([id, quantity]) => `${quantity} × ${itemName(id)}`).join(' + '),
        recipe.station === 'kitchen' ? 'Cooking station' : recipe.station ?? 'None',
        recipe.discipline === undefined ? 'None' : `${DISCIPLINES[recipe.discipline]} level ${recipe.level ?? 1}`,
      ]),
    },
  });
  if (pieces.length) sections.push({ id: 'building', title: 'Building uses', paragraphs: [`Used for: ${pieces.map(piece => piece.name).join(', ')}.`] });
  return {
    summary,
    lead: `${item.name} belongs to the settlement expansion, available when settlements are enabled in your world. ${item.healthRestore ? `Each portion restores ${item.healthRestore} base HP.` : item.weaponDamage ? `Its base weapon damage is ${item.weaponDamage}.` : `Each bag slot holds up to ${item.maxStack}.`}`,
    source: making ? 'Settlement crafting' : patches.length ? [...new Set(patches.map(patch => REGIONS[patch.region].name))].join(' · ') : item.id === 'carrot' ? 'Settlement planters' : 'Settlement expansion',
    sections,
    related: [...new Set(['frontier-materials-crafting', 'building-storage', 'frontier-disciplines', ...recipes.flatMap(recipe => [recipe.output, ...Object.keys(recipe.inputs)]).filter(id => id !== item.id).map(itemArticleSlug)])].slice(0, 6),
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  };
}

function gatheringSection(item: ItemDef): WikiSection | undefined {
  const trees = TREE_SEEDS.filter(tree => tree.itemId === item.id);
  const nodes = NODE_SEEDS.filter(node => node.itemId === item.id);
  if (!trees.length && !nodes.length) return undefined;
  const locations = [
    ...trees.map(tree => ({ ...tree, kind: 0 as const })),
    ...nodes,
  ];
  return {
    id: 'gathering-locations', title: 'Gathering locations',
    paragraphs: [`Each completed harvest gives one ${item.name.toLowerCase()}. Times below are the base gather time and the node’s separate regrowth wait. Coordinates are written as (x, z).`],
    table: {
      headers: ['Source', 'Tile', 'Gather', 'Regrow', 'XP'],
      rows: locations.map(node => [
        NODE_KINDS[node.kind].name, `(${node.x}, ${node.z})`,
        seconds(NODE_KINDS[node.kind].harvestTicks), seconds(NODE_KINDS[node.kind].regrowTicks),
        `${harvestXp(node.kind)} ${node.kind === 0 ? 'Foraging' : 'Beachcombing'}`,
      ]),
    },
  };
}

function gardenSection(item: ItemDef): WikiSection | undefined {
  const crop = GARDEN_CROPS.find(entry => entry.itemId === item.id);
  if (!crop) return undefined;
  return {
    id: 'garden', title: 'Growing in your garden',
    paragraphs: [
      `Planting consumes one ${item.name.toLowerCase()}. After ${crop.growMs / 3_600_000} real-time hours, the crop returns ${crop.yield} berries and awards ${crop.xp} Foraging XP when harvested: a net gain of ${crop.yield - 1} ${crop.yield - 1 === 1 ? 'berry' : 'berries'} after the planting cost.`,
      'Your crop grows while you are offline and stays ripe until harvested. Only you can tend your plots. If the full harvest will not fit in your bag, the crop waits safely for you to make space.',
    ],
  };
}

function recipeSection(item: ItemDef): WikiSection | undefined {
  const recipes = RECIPES.filter(recipe => recipe.output?.itemId === item.id || recipe.inputs.some(input => input.itemId === item.id));
  if (!recipes.length) return undefined;
  return {
    id: 'recipes', title: item.weaponDamage > 0 || item.id === 'berry_mash' ? 'Crafting recipe' : 'Used in crafting',
    table: {
      headers: ['Recipe', 'Ingredients', 'Level', 'Crafting XP', 'Result'],
      rows: recipes.map(recipe => [recipe.name, ingredients(recipe), String(recipe.level), String(recipe.xp), recipe.output ? `${recipe.output.quantity} × ${itemName(recipe.output.itemId)}` : 'Permanent cosmetic unlock']),
    },
  };
}

function useSection(item: ItemDef): WikiSection | undefined {
  if (item.healthRestore > 0) return {
    id: 'eating', title: 'Eating and combat timing',
    paragraphs: [`Eating consumes one ${item.name.toLowerCase()} and restores up to ${item.healthRestore} base HP, capped at your maximum health. The original bag and quick bar prevent eating at full health; when injured, any healing beyond your missing HP is lost. Each bite starts a ${seconds(EAT_COOLDOWN_TICKS)} eating cooldown and delays your next melee swing by ${seconds(EAT_SWING_DELAY_TICKS)}. Put down giant berry cargo before eating.`,
      'When eating through settlement Bag & storage, active Cultivation level 10 adds two healing, capped at ten HP per portion.'],
  };
  if (item.weaponDamage > 0) return {
    id: 'wielding', title: 'Wielding and combat',
    paragraphs: [`New weapons go into your bag. Drag the ${item.name} to quick slot 1, 2 or 3, then use that slot to wield it. It deals ${item.weaponDamage} damage per swing at the normal ${seconds(SWING_INTERVAL_TICKS)} attack interval. Carrying it elsewhere in your bag does not change damage. Moving the last quick-slot copy out of the quick bar puts it away; taking giant berry cargo also frees both hands.`],
  };
  return undefined;
}

/** Facts and reference tables follow the current shared game definitions.
 * Server-only behaviours are documented above with their reducer sources. */
export const itemArticles: WikiArticle[] = Object.values(ITEM_DEFS).map(item => {
  const detail = notes[item.id] ?? frontierNotes(item);
  const gathering = gatheringSection(item);
  const garden = gardenSection(item);
  const recipe = recipeSection(item);
  const use = MATERIALS[item.id] ? undefined : useSection(item);
  const settlementSections = MATERIALS[item.id] ? [] : frontierNotes(item).sections.filter(section =>
    section.id === 'resource-patches' || section.id === 'settlement-recipes');
  const sources = new Set([
    'shared/sim/items.ts', 'shared/sim/constants.ts',
    ...(gathering ? ['shared/sim/nodes.ts', 'shared/sim/skills.ts', 'spacetimedb/src/reducers/tick.ts'] : []),
    ...(garden ? ['shared/sim/garden.ts', 'spacetimedb/src/reducers/garden.ts'] : []),
    ...(recipe ? ['shared/sim/nodes.ts', 'spacetimedb/src/reducers/craft.ts'] : []),
    ...(settlementSections.length ? ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts'] : []),
    ...(use ? ['spacetimedb/src/reducers/inventory.ts'] : []),
    ...(item.healthRestore ? ['frontend/src/Components/Inventory.tsx', 'frontend/src/Components/CombatHud.tsx'] : []),
    ...(item.weaponDamage ? ['spacetimedb/src/reducers/combat.ts'] : []),
    ...detail.sourceFiles ?? [],
  ]);
  return {
    slug: itemArticleSlug(item.id), title: item.name, category: 'Items',
    itemId: item.id, icon: item.icon, summary: detail.summary, lead: detail.lead,
    facts: [
      { label: 'Type', value: item.weaponDamage ? 'Melee weapon' : item.healthRestore ? 'Food' : item.maxStack === 1 ? 'Equipment' : 'Material' },
      { label: 'Source', value: detail.source },
      { label: 'Max stack', value: `${item.maxStack} per slot` },
      ...(item.healthRestore ? [{ label: 'Healing', value: `${item.healthRestore} HP` }] : []),
      ...(item.weaponDamage ? [{ label: 'Damage', value: `${item.weaponDamage} per swing` }] : []),
      ...(item.id === 'stick' ? [{ label: 'Route key', value: 'Grove → Coast' }] : []),
      ...(item.id === 'stone_club' ? [{ label: 'Route key', value: 'Coast → Boulders' }] : []),
    ],
    sections: [gathering, recipe, ...detail.sections, ...settlementSections, garden, use].filter((section): section is WikiSection => !!section),
    related: detail.related, sourceFiles: [...sources],
  };
});
