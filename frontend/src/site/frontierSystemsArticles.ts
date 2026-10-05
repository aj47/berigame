import { getItemDef, SKILL_MAX_LEVEL, xpForLevel } from '@sim';
import {
  DISCIPLINES, FRONTIER, FRONTIER_RECIPES, PLOTS, PORTS, REGIONS, RESOURCE_PATCHES, SPECIES,
  type Cost, type RegionId,
} from '../../../shared/sim/frontier/catalog';
import type { WikiArticle } from './wikiContent';

const itemName = (id: string) => getItemDef(id)?.name ?? id;
const ingredients = (cost: Cost) => Object.entries(cost).map(([id, quantity]) => `${quantity} ${itemName(id)}`).join(' + ');
const point = (position: { x: number; z: number }) => `(${position.x}, ${position.z})`;
const availability = 'These activities are available in the public beta, where the settlements expansion is enabled.';
const stationName = (station?: string) => ({
  workbench: 'Workbench', kiln: 'Kiln', kitchen: 'Cooking station', harbour: 'Harbour',
}[station ?? ''] ?? 'None');

/** Expansion guides follow the shared catalogue and the server actions that apply it. */
export const frontierSystemsArticles: WikiArticle[] = [
  {
    slug: 'frontier-materials-crafting',
    title: 'Meadows materials & crafting',
    category: 'Skills & activities',
    summary: 'Gather supplies, make tools, grow carrots and prepare your first skiff.',
    lead: `${availability} Open Craft (C) for camp and settlement recipes in one place. Start with the nearby timber, stone, fibre and clay patches, then use the public town workshop to make supplies for a home, companions and sailing.`,
    facts: [
      { label: 'Settlement recipes', value: String(FRONTIER_RECIPES.length) },
      { label: 'Gathering reach', value: '2 tiles' },
      { label: 'Public workshop', value: 'Meadows town square' },
      { label: 'Crafting XP', value: '15 Building XP per craft' },
    ],
    sections: [
      { id: 'first-tools', title: 'Start with a few useful tools', bullets: [
        'Look for timber pines with pale trunk bands and wood chips. Your starter hatchet collects one Timber per cut. Carry a crafted Axe to use its metal head and receive two Timber per cut; both count toward gathering quests.',
        'Make a Hammer from one Timber and two Stone for Tools of the trade. Claim the quest reward at the steward when it is your active quest.',
        'Turn Timber into Planks and Plant fibre into Rope. These are used in stables, sails and skiff hulls.',
        'Craft groups recipes into Gear, Food, Tools and Materials, with the ones you can make first in each group. Tap Ready to see only what your bag can make now, or a group name to show just that group. Every recipe displays item icons, held / needed ingredients, and any station or discipline requirement.',
      ] },
      { id: 'patches', title: 'Where to gather', paragraphs: [
        'Six marked timber pines form a gathering route around Meadows town. Move to another tree while a stump regrows. The coordinates below belong to each named region. Stand within two tiles of a patch to gather. Plant fibre, Reeds and Carrot seeds award Cultivation XP; other resource patches award Exploration XP. Each completed gather awards 8 XP, even when that discipline is inactive.',
        `Gathering takes ${FRONTIER.gatherDuration / 1000} seconds before materials and XP arrive. Timber trees are chopped down, leave a stump and regrow after ${FRONTIER.timberRegrow / 1000} seconds. Only one character can work a patch at a time. Moving, stopping, taking damage or disconnecting interrupts an unfinished action.`,
        'With Cultivation active at level 5, Plant fibre, Reeds, Greenberry and Strawberry gathering takes 2.4 seconds. Keep enough bag space for the whole yield; settlement gathering cannot finish into a full bag.',
        'Reeds and Resin are available in Reedwake, but currently have no crafting or building recipe. Keep this in mind when choosing what to carry home.',
      ], table: {
        headers: ['Region', 'Resource', 'Tile'],
        rows: RESOURCE_PATCHES.map(patch => [REGIONS[patch.region].name, itemName(patch.item), point(patch)]),
      } },
      { id: 'workstations', title: 'Using a workstation', paragraphs: [
        'Recipes without a station can be crafted from Craft. Workbench, Kiln and Cooking station recipes can also be made within four tiles of the Meadows steward at the public town workshop.',
        'For a private workstation, stand within two tiles of it on a plot you own or have building permission to use. Harbour recipes require a harbour; the public town workshop does not replace it. Finish combat and make room in your bag before crafting.',
        'The table shows base ingredients and outputs. With Building active at level 2, recipes that normally produce two or more items produce one extra. At Building level 10, each recipe ingredient requiring four or more items costs one fewer. These perks do not reduce the materials used to place building pieces.',
      ] },
      { id: 'recipes', title: 'Settlement recipe reference', table: {
        headers: ['Result', 'Ingredients', 'Station', 'Active discipline required'],
        rows: FRONTIER_RECIPES.map(recipe => [
          `${recipe.quantity} ${itemName(recipe.output)}`, ingredients(recipe.inputs), stationName(recipe.station),
          recipe.discipline === undefined ? 'None' : `${DISCIPLINES[recipe.discipline]} level ${recipe.level ?? 1}`,
        ]),
      } },
      { id: 'carrots', title: 'Grow carrots on your land', paragraphs: [
        'Place a Planter, walk within two tiles of it and plant one Carrot seed. You need building permission on the plot. Find seeds in Reedwake or ask a trained Burrowbun to find one.',
        'Carrots ripen in two hours. Carry a Watering can when planting to reduce that to ninety minutes. Each harvest yields three Carrots, or four with Cultivation active at level 2. Planting awards 8 Cultivation XP and harvesting awards 20.',
        'A Carrot restores 3 base HP. Two Carrots and one Strawberry make two Travel rations at a Cooking station or the public workshop; each ration restores 8 base HP. Active Cultivation level 10 adds two healing, up to ten HP per portion.',
      ] },
      { id: 'equipment', title: 'What the equipment does', table: { headers: ['Item', 'Use'], rows: [
        ['Axe', 'Carry it to gather two Timber per completed action.'],
        ['Pick', 'Carry it with Might active at level 10 to gather two Stone or Iron ore per action.'],
        ['Hammer', 'Craft it for Tools of the trade; it is not consumed when placing building pieces.'],
        ['Watering can', 'Carry it when planting to shorten carrot growth to ninety minutes.'],
        ['Creature harness', 'Spend one to train a companion with Beastcraft active at level 2.'],
        ['Iron club', '9 base damage; move it into a quick slot in Bag, then wield it. It does not replace the Stick or Stone Club as an island route key.'],
        ['Padded vest', 'Equip from Bag or a quick slot for +3 maximum HP while carried. Unequip it to remove the bonus. Total maximum HP is capped at 36.'],
      ] } },
    ],
    related: ['meadows', 'coins-quests', 'building-storage', 'frontier-disciplines', 'wildlife-companions', 'sailing-islands'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'shared/sim/items.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  },
  {
    slug: 'wildlife-companions',
    title: 'Wildlife & companions',
    category: 'Skills & activities',
    summary: 'Observe creatures, offer feed and train a travelling companion.',
    lead: `${availability} Click a creature, or open More → Wildlife, to observe it, befriend it or call on your companions. Burrowbuns, Bumblewisps and Hootlings live in the Meadows, Thistlefoxes and Puddlefrogs roam Bramblewild’s outer lands, and more species wait in Reedwake and Cinder Shoal.`,
    facts: [
      { label: 'Wild species', value: String(SPECIES.length) },
      { label: 'Companions owned', value: `Up to ${FRONTIER.maxCompanions}` },
      { label: 'Active companion', value: '1 at a time' },
      { label: 'Ordinary taming', value: '2 feedings · 6 seconds apart' },
    ],
    sections: [
      { id: 'first-friend', title: 'Befriend your first creature', bullets: [
        'Click a tameable creature and choose Observe; you walk within four tiles first. First observing a species awards 15 Beastcraft XP.',
        'Make Taming feed in Craft: two Greenberries and one Plant fibre produce two portions before Building bonuses.',
        'Move within two tiles and Offer feed. Wait at least six seconds before the second feeding. Each feeding consumes one portion; Beastcraft active at level 5 reduces taming to one feeding.',
        `A successful tame awards 30 Beastcraft XP. Your first companion becomes active automatically. Build your own Creature stable before befriending additional companions; you can own ${FRONTIER.maxCompanions} in total.`,
      ] },
      { id: 'species', title: 'Species and their homes', table: {
        headers: ['Species', 'Home', 'Can befriend?', 'Trained companion ability'],
        rows: SPECIES.map(species => [
          species.name, `${REGIONS[species.region as RegionId].name} (${species.home.x}, ${species.home.z})`, species.tameable ? 'Yes' : 'No',
          ({
            burrowbun: 'Find one Carrot seed.',
            reedhorn: 'Carry supplies in six cargo slots.',
            glowmoth: 'List resource patch locations in your current region.',
            shellback: 'Guard carried berry expedition cargo from Giant bites for 12 seconds.',
            bristleback: 'Hostile encounter; cannot become a companion.',
            thistlefox: 'Forage one berry: Strawberry, Greenberry or Blueberry, changing each minute.',
            puddlefrog: 'Gather two Plant fibre.',
            bumblewisp: 'Collect one Resin.',
            hootling: 'List the wild creatures in your current region and where they are.',
            driftgull: 'Bring back one Driftwood.',
            emberling: 'Restore six health, up to your maximum.',
          } as Record<string, string>)[species.id] ?? species.utility,
        ]),
      } },
      { id: 'training', title: 'Train and call a companion', paragraphs: [
        'Activate Beastcraft and reach level 2. Make a Creature harness, approach your own companion and choose Train. Training consumes one harness, awards 25 Beastcraft XP and enables that creature’s utility.',
        'Choose Call companion at the Meadows town square or beside an accessible Creature stable. Only one owned creature is active at a time. Active companions keep pace beside you on land, including across Bramblewild and into the Meadows, and rejoin after you return to land from a voyage.',
        'Use ability requires your trained, active companion within two tiles and Beastcraft active at level 2. Abilities normally recover in sixty seconds; active Beastcraft level 10 reduces this to thirty seconds. Taming, food and other abilities can also briefly delay the next ability.',
      ] },
      { id: 'cargo-and-protection', title: 'Pack supplies and expedition help', paragraphs: [
        'Training a Reedhorn creates six cargo slots. Use Bag → Bank → Storage location to deposit or withdraw while your Reedhorn is active, nearby and Beastcraft level 2 is active.',
        'A Shellback’s ability applies to the giant berry expedition while you are carrying its cargo. It prevents the expedition Giant from biting that cargo for twelve seconds. It does not protect your ordinary bag or boat inventory.',
        'If you are defeated, your active companion rests for one minute. Any Reedhorn pack contents join your dropped supplies and remain collectible for five minutes. Companions themselves remain yours; call one again from town or a stable after its rest.',
      ] },
      { id: 'bristleback', title: 'Bristleback encounters', paragraphs: [
        'Bristlebacks in Cinder Shoal cannot be tamed. Attack from an adjacent tile with food and equipment ready. A strike makes the creature retaliate for 3 HP, reduced to 1 while Might’s Brace is active.',
        'Defeating one awards two Plant fibre and 25 Might XP, in addition to the one Might XP earned for each attack. The Bristleback rests for a minute before becoming available again.',
      ] },
    ],
    related: ['meadows', 'frontier-materials-crafting', 'frontier-disciplines', 'building-storage', 'sailing-islands', 'expeditions'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'spacetimedb/src/reducers/frontier.ts', 'spacetimedb/src/lib/adventure.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  },
  {
    slug: 'frontier-disciplines',
    title: 'Five disciplines, two active choices',
    category: 'Skills & activities',
    summary: 'Train Might, Cultivation, Building, Beastcraft and Exploration, then choose two sets of perks.',
    lead: `${availability} Settlement disciplines grow alongside the original Foraging, Beachcombing and Crafting skills. You retain XP in all five disciplines, but advanced perks and recipes require the relevant discipline to be one of your two active choices.`,
    facts: [
      { label: 'Disciplines', value: String(DISCIPLINES.length) },
      { label: 'Active choices', value: '2 different disciplines' },
      { label: 'Level cap', value: String(SKILL_MAX_LEVEL) },
      { label: 'Change pair', value: `${FRONTIER.switchCost} coins · ${FRONTIER.switchCooldown / 3_600_000} hours between changes` },
    ],
    sections: [
      { id: 'choose', title: 'Choose your active pair', paragraphs: [
        'Visit the Meadows town square and open More → Disciplines. Select two different disciplines and Activate pair. Your first pair is free. Later changes cost 20 coins after twenty-four hours. To skip the wait, choose Switch now for 50 coins total: the normal 20 plus 30 extra. Each change starts a new twenty-four-hour wait; choosing your current pair again costs nothing.',
        'Change choices in town while outside combat, claim conflicts and voyages. Changing your pair preserves all XP. Basic gathering, crafting and other available activities continue to award the appropriate XP even if that discipline is inactive.',
        'Building and Beastcraft are a useful first pair for a home and trained companion. Choose Might for combat and mining perks, Cultivation for crops and food, or Exploration for island discovery and docking.',
      ] },
      { id: 'starting-xp', title: 'Your starting discipline XP', paragraphs: [
        'The first time your character uses a Meadows activity, existing skill and adventure progress is copied into the matching disciplines once. Growing or Foraging seeds Cultivation; Building or Crafting seeds Building; Exploring or Beachcombing seeds Exploration. The higher total is used for each pair. Fighting seeds Might and Befriending seeds Beastcraft.',
        'This preserves the value of your island progress without spending it. After this initial boost, disciplines and island skills earn XP separately. Skills & techniques contains camp abilities; Disciplines contains the two active perk choices.',
      ] },
      { id: 'perks', title: 'What each discipline unlocks', table: { headers: ['Discipline', 'Level 2', 'Level 5', 'Level 10'], rows: [
        ['Might', '+10% weapon damage within the 10-damage cap.', 'Brace for 12 seconds; Bristleback retaliation falls from 3 HP to 1. Reuse after 30 seconds.', 'Carry a Pick to gather two Stone or Iron ore per action.'],
        ['Cultivation', 'Harvest four Carrots instead of three.', 'Gather Plant fibre, Reeds, Greenberries and Strawberries every 2.4 seconds.', '+2 healing per food portion, capped at 10 HP.'],
        ['Building', '+1 output for recipes whose base batch contains at least two items.', 'Unlock Brick walls, Iron fittings and the Iron club recipe.', 'Reduce each recipe ingredient of four or more by one.'],
        ['Beastcraft', 'Craft harnesses, train companion abilities and use trained Reedhorn cargo.', 'One feeding tames an observed creature.', 'Companion ability recovery falls from 60 to 30 seconds.'],
        ['Exploration', 'Survey one hidden cache per expansion land region.', 'Dock within four tiles of a port, instead of two.', '—'],
      ] }, paragraphs: [
        'Having Might active also adds 3 maximum HP. An equipped, carried Padded vest adds another 3, up to 36 total. These settlement benefits do not replace the original island’s Stick and Stone Club route keys.',
      ] },
      { id: 'earning-xp', title: 'How to earn discipline XP', table: { headers: ['Discipline', 'Activity', 'XP'], rows: [
        ['Might', 'Attack in a valid combat encounter', '1 per attack'],
        ['Might', 'Defeat a Bristleback', '25 additional'],
        ['Cultivation', 'Gather Plant fibre, Reeds or Carrot seeds', '8'],
        ['Cultivation', 'Plant / harvest a carrot planter', '8 / 20'],
        ['Building', 'Craft a settlement recipe / complete a supply order', '15 / 10'],
        ['Building', 'Place your first piece of each building type', '25 per type'],
        ['Building', 'Assemble a skiff', '40'],
        ['Beastcraft', 'First observe a species / tame a creature / train a companion', '15 / 30 / 25'],
        ['Exploration', 'Gather other settlement resource patches', '8'],
        ['Exploration', 'First discover a port by docking / survey a region cache', '50 / 25'],
      ] } },
      { id: 'levels', title: 'Level milestones', paragraphs: [
        'Each discipline uses the same total-XP curve: 25 × (level − 1)². XP remains saved when you change your active pair. The original island skills have their own separate XP totals.',
      ], table: { headers: ['Level', 'Total XP'], rows: [1, 2, 5, 10, 20, 30].map(level => [String(level), xpForLevel(level).toLocaleString('en-US')]) } },
      { id: 'survey', title: 'Survey a region cache', paragraphs: [
        'With Exploration active at level 2, search the far south-east of the Meadows, Reedwake or Cinder Shoal. Within three tiles of (118, 112), use Survey a region cache in Disciplines to receive one Goldberry and 25 Exploration XP. Each region’s cache can be found once per character.',
      ] },
    ],
    related: ['skills-progression', 'frontier-materials-crafting', 'wildlife-companions', 'sailing-islands', 'coins-quests'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'shared/sim/skills.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  },
  {
    slug: 'sailing-islands',
    title: 'Sailing, skiffs & new islands',
    category: 'World',
    summary: 'Build a four-person skiff, carry supplies and sail to Reedwake and Cinder Shoal.',
    lead: `${availability} Bramblewild and the Meadows share a walkable home island. Reedwake and Cinder Shoal are reached by skiff. Open More → Sailing to assemble a boat, manage its crew and choose a destination.`,
    facts: [
      { label: 'Boat ownership', value: '1 skiff per character' },
      { label: 'Crew capacity', value: '4 characters, including pilot' },
      { label: 'Boat cargo', value: '12 slots' },
      { label: 'First harbour', value: 'Driftwood Harbour · (46, 29)' },
    ],
    sections: [
      { id: 'first-skiff', title: 'Build your first skiff', bullets: [
        'Follow the steward’s quests towards The shipwright, then walk to Driftwood Harbour in Bramblewild at (46, 29). Meet shipwright records the visit for the quest.',
        'Craft a Skiff hull at a harbour from 20 Planks and 6 Rope. Craft a Sail at a Workbench or the public town workshop from 8 Cloth and 4 Rope. Active Building perks can lower these base ingredient costs.',
        'Stand within four tiles of a harbour and choose Assemble skiff. This consumes one hull and one sail, creates twelve cargo slots and awards 40 Building XP. You can own one skiff.',
        'Use Bag → Bank → Storage location to load food and useful supplies into the boat. Depositing food records progress for Prepare for the crossing. Food is carried as provisions; sailing does not automatically consume it.',
      ] },
      { id: 'crew', title: 'Invite and organise your crew', paragraphs: [
        'The owner has full boat access. Under Crew permissions, grant other characters boarding, piloting and cargo access separately. Boarding permission lets a player join at a harbour; piloting permission lets an onboard player take the helm; cargo permission lets them transfer supplies.',
        'Walk within two tiles of the docked boat and Board. A skiff holds up to four characters, including the pilot. One pilot steers the boat and all passengers move together.',
        'To use boat cargo, be aboard or stand within two tiles of the boat with cargo permission. Disembark is available only while docked at a harbour.',
      ] },
      { id: 'voyage', title: 'Sail, dock and explore', bullets: [
        'Board, choose Take helm, then choose Sail beside a destination or tap the open sea to steer.',
        'Skiffs move one sea tile every 0.6 seconds. With Exploration active at level 10, the pilot covers two tiles per tick. The whole crew and cargo travel together.',
        'Reach the destination’s sea coordinates, then choose Dock. Ordinary docking range is two tiles; Exploration active at level 5 increases it to four.',
        'Choose Disembark to explore. First discovering a port by docking awards 50 Exploration XP to each passenger and records the destination for relevant quests.',
        'Return to the harbour, board and sail home when ready. If everyone aboard is offline for five minutes, an at-sea skiff returns to its last port with its cargo.',
      ] },
      { id: 'ports', title: 'Harbour coordinates', paragraphs: ['Land and sea coordinates use separate maps. The sea location is your docking destination; the land location is where you board or disembark.'], table: {
        headers: ['Destination', 'Land harbour', 'Sea approach'],
        rows: PORTS.map(port => [REGIONS[port.region].name, point(port), point(port.sea)]),
      } },
      { id: 'destinations', title: 'What to find beyond home', table: { headers: ['Island', 'Resources', 'Wildlife', 'Land'], rows: [
        ['Reedwake', 'Reeds, Resin, Plant fibre, Timber, Carrot seeds and Greenberries.', 'Reedhorn and Glowmoth.', `${PLOTS.filter(plot => plot.region === 'reedwake').length} claim plots.`],
        ['Cinder Shoal', 'Iron ore, Stone, Clay and Timber.', 'Shellback and hostile Bristleback.', `${PLOTS.filter(plot => plot.region === 'cinder').length} claim plots.`],
      ] }, paragraphs: [
        'Reedwake supplies Carrot seeds and useful companions. Cinder Shoal provides Iron ore for Iron fittings and the Iron club, with Building active at level 5 for those recipes.',
        'The same land ownership and upkeep rules apply on these islands. Paid plots, boats, companions and personal vaults follow their own ownership rules; read Land ownership before establishing a remote home.',
      ] },
    ],
    related: ['meadows', 'coins-quests', 'frontier-materials-crafting', 'frontier-disciplines', 'wildlife-companions', 'land-ownership'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'shared/sim/frontier/regions.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  },
];
