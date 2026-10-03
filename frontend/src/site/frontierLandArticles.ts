import { getItemDef } from '@sim';
import {
  DAY, DISCIPLINES, FRONTIER, ORDERS, PIECES, PLOTS, QUESTS,
  REGIONS, RESOURCE_PATCHES, WEEK, type Cost,
} from '../../../shared/sim/frontier/catalog';
import type { WikiArticle } from './wikiContent';

const itemName = (id: string) => getItemDef(id)?.name ?? id;
const cost = (items: Cost) => Object.entries(items).map(([id, count]) => `${count} ${itemName(id)}`).join(' + ');
const claimPrice = FRONTIER.deed + FRONTIER.taxes[0];
const starterCoins = QUESTS.slice(0, 3).reduce((total, quest) => total + quest.coins, 0);
const availability = 'The Meadows expansion is enabled in the public beta. Other worlds can enable it through their world owner.';

/** Expansion guides use the same definitions as the game for prices, quests and pieces. */
export const frontierLandArticles: WikiArticle[] = [
  {
    slug: 'meadows',
    title: 'Bramblewild Meadows',
    category: 'World',
    summary: 'Follow the east harbour trail to quests, shared land, a public workshop and your first home.',
    lead: `Bramblewild Meadows is the eastern district of the home island. Walk there along the harbour trail to meet the steward, earn coins and build a home among other players. ${availability}`,
    facts: [
      { label: 'Getting there', value: 'Walk east from Bramblewild' },
      { label: 'Meadow plots', value: String(PLOTS.filter(plot => plot.region === 'settlement').length) },
      { label: 'First claim', value: `${claimPrice} coins · first week included` },
      { label: 'Town square', value: `Meadows (${REGIONS.settlement.spawn.x}, ${REGIONS.settlement.spawn.z})` },
    ],
    sections: [
      { id: 'getting-there', title: 'Follow the harbour trail', paragraphs: [
        'From the Grove, carry a Stick through the brambles to the Coast, then follow the east harbour trail into the Meadows. The land is connected: clicking dry ground across the district boundary queues an ordinary walk. Walk to Meadows town and Return to the steward also follow this route.',
        'The minimap shows the connected home island. If you are carrying expedition cargo or taking part in a duel, finish that activity before heading to the Meadows. Water and blocked terrain still stop a route.',
        'Meadows coordinates in resource and plot lists are local to that district. The steward is at (31, 64) in the Meadows; these are different from Bramblewild’s original tile coordinates.',
      ] },
      { id: 'start-a-home', title: 'From arrival to your first home', bullets: [
        'Open Quests and talk to the steward in the town square. Collect the reward there after completing each objective.',
        'Gather timber and stone nearby, then open Workshop to make a Hammer. Finish the first three steward quests to unlock a land claim.',
        `Those three quests award ${starterCoins} coins in total, enough for a ${claimPrice}-coin starter plot. Open Your land, choose an available plot and use Walk to plot before claiming it.`,
        'Open Build on this plot to place your first floor, wall and roof. The next quests introduce wildlife and your first companion, followed by supply orders and upkeep. Your first week is already paid.',
        'Continue the quest chain into wildlife, a stable, useful work and sailing. Your next objective stays at the top of Quests.',
      ] },
      { id: 'town-services', title: 'Find the right menu', table: { headers: ['Menu', 'What it contains'], rows: [
        ['Quests', 'Your next objective, reward collection, repeatable supply orders, completed quests and notices'],
        ['Your land', 'Your home or a nearby available plot, claiming, upkeep, building and plot management'],
        ['Workshop', 'Recipes you can make now, with missing supplies and later recipes available below'],
        ['More → Wildlife', 'Observe, befriend, train and call creatures'],
        ['More → Disciplines', 'Choose active disciplines and inspect their levels and perks'],
        ['More → Sailing', 'The shipwright, skiff construction, crew and voyages'],
        ['More → Bag & storage', 'Carried items, the personal town vault, chests, cargo and nearby trade'],
      ] } },
      { id: 'local-resources', title: 'Gather around the town square', paragraphs: [
        'Approach a resource and gather while beside it. The nearby patches provide the materials for your first tools and building pieces. Watch the gathering action finish before collecting again.',
        'An Axe increases timber yield. Some discipline perks improve gathering later. The public town workshop lets you use ordinary workstation recipes before you have built your own stations; hull construction still requires a harbour.',
      ], table: { headers: ['Resource', 'Meadows tile'], rows: RESOURCE_PATCHES.filter(node => node.region === 'settlement').map(node => [itemName(node.item), `(${node.x}, ${node.z})`]) } },
      { id: 'comfortable-view', title: 'Keep the map clear', paragraphs: [
        'The ground and object labels stay compact. Hover an object for its action, then click the object to approach and interact. Plot markers identify the plot you can inspect in Your land.',
        'Use the × beside the tip to hide tips and quest reminders. Settings lets you show them again, hide world labels, hide character nameplates and adjust graphics or camera controls. These display preferences are saved on your device.',
      ] },
      { id: 'saved-progress', title: 'Progress saves automatically', paragraphs: [
        'The server saves your character’s progress, coins, land and buildings as you play. You do not need to download a save file before buying land or when you leave.',
        'Optional character recovery helps you regain access to the same guest character if you lose the browser’s login or move to another device. It is separate from saving world progress. See Land ownership & upkeep for the access-recovery controls.',
      ] },
    ],
    related: ['coins-quests', 'land-ownership', 'building-storage', 'frontier-materials-crafting', 'wildlife-companions', 'sailing-islands', 'world-regions', 'controls'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/homeMap.ts', 'shared/sim/frontier/engine.ts', 'frontend/src/frontier/FrontierPanel.tsx', 'frontend/src/Components/SettingsPanel.tsx'],
  },
  {
    slug: 'coins-quests',
    title: 'Coins & steward quests',
    category: 'Skills & activities',
    summary: 'Earn your first 50 coins, claim quest rewards and keep a home funded with repeatable supply orders.',
    lead: `Earn coins by completing steward quests and delivering supply orders. Gathering supplies is the first step; turn in an order or collect a completed quest reward to receive the coins. ${availability}`,
    facts: [
      { label: 'Starter quest rewards', value: `${starterCoins} coins total` },
      { label: 'Supply order', value: '10 coins per delivery' },
      { label: 'Repeatable allowance', value: `${FRONTIER.repeatCap} coins per UTC day` },
      { label: 'Starter upkeep', value: `${FRONTIER.taxes[0]} coins per week` },
    ],
    sections: [
      { id: 'first-coins', title: 'Earn enough for your first plot', paragraphs: [
        'Open Quests at the steward in the Meadows town square. Talk to the steward, gather the requested timber, then make a Hammer in Workshop. A Hammer needs one Timber and two Stone. Finish and collect each quest before moving to the next reward.',
        `The first three rewards add up to ${starterCoins} coins. Claiming an available starter plot costs ${claimPrice}: ${FRONTIER.deed} for the deed and ${FRONTIER.taxes[0]} for its first week of upkeep. Completing Tools of the trade unlocks that purchase.`,
      ], table: { headers: ['Quest', 'Objective', 'Reward'], rows: QUESTS.slice(0, 3).map(quest => [quest.title, quest.text, `${quest.coins} coins`]) } },
      { id: 'supply-orders', title: 'Repeatable supply orders', paragraphs: [
        'Open Quests → Earn coins · supply orders. Stand near the steward or a harbour’s shipwright with the requested materials in your bag, then choose Deliver. Each delivery consumes those supplies and gives 10 coins. You can repeat the same order or mix orders.',
        `Supply orders share a ${FRONTIER.repeatCap}-coin daily allowance for your character, so you can earn from ${FRONTIER.repeatCap / 10} deliveries each UTC day. One-time quest rewards are separate from this allowance. Each order also gives 10 Building XP.`,
      ], table: { headers: ['Supplies to deliver', 'Coins per order'], rows: ORDERS.map(order => [cost(order.inputs), '10']) } },
      { id: 'collecting-rewards', title: 'Collecting quest rewards', paragraphs: [
        'Quests follow the order below. Quests shows one next objective, while All quests contains the full list. After meeting the objective, return to the steward or a shipwright and choose Collect coins or Complete quest. Completing the activity alone does not collect its reward.',
        'Hand-in quests consume the listed materials from your bag when you choose Deliver. Help the camp needs six Planks. Cinder on the horizon needs a recorded Cinder Shoal visit and two Iron ore.',
        'Some milestones award no coins but unlock the next part of the journey. Keep doing supply orders when you need money for upkeep or construction progress.',
      ], table: { headers: ['Quest', 'Objective', 'Coins'], rows: QUESTS.map(quest => [quest.title, quest.text, String(quest.coins)]) } },
      { id: 'plan-your-coins', title: 'Plan for upkeep and expansion', paragraphs: [
        `A starter plot costs ${FRONTIER.taxes[0]} coins per week after the first included week. Three supply orders cover one on-time starter week. The ${FRONTIER.repeatCap}-coin daily allowance can fund two starter weeks before other spending.`,
        'Bigger plots have higher weekly upkeep, and late payments include missed weeks. Your land shows the amount due before you pay. Check Land ownership & upkeep before expanding or taking over a vulnerable plot.',
      ] },
    ],
    related: ['meadows', 'land-ownership', 'building-storage', 'frontier-materials-crafting', 'sailing-islands'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/model.ts', 'shared/sim/frontier/engine.ts', 'frontend/src/frontier/FrontierPanel.tsx'],
  },
  {
    slug: 'land-ownership',
    title: 'Land ownership & upkeep',
    category: 'World',
    summary: 'Buy a shared-world plot, expand it, manage helpers and understand overdue upkeep and capture.',
    lead: `A land claim gives your character a place in the shared world to build and store supplies. Your home remains yours while its upkeep is protected; unpaid plots eventually become open to an announced capture challenge. ${availability}`,
    facts: [
      { label: 'Ownership limit', value: 'One owned or challenged plot' },
      { label: 'Starter purchase', value: `${claimPrice} coins · first week included` },
      { label: 'Upkeep grace', value: `${FRONTIER.grace / DAY} days` },
      { label: 'Prepayment limit', value: `${FRONTIER.maxPrepay / WEEK} weeks ahead` },
    ],
    sections: [
      { id: 'claim-land', title: 'Buy your first plot', bullets: [
        'Complete the steward’s first three quests through Tools of the trade. Collect each completed quest reward at the steward or a shipwright.',
        'Open Your land or click an available plot marker. Your existing home appears first once you own one; Browse other plots lets you inspect nearby alternatives.',
        `Choose Walk to plot and stand beside its marker. Claim costs ${claimPrice} coins, including a ${FRONTIER.deed}-coin deed and the first ${FRONTIER.taxes[0]}-coin week. The plot starts at ${FRONTIER.sizes[0]} × ${FRONTIER.sizes[0]} tiles.`,
        'Choose Claim when you are in range. You can own one plot at a time across all islands, and cannot buy another while you are challenging someone else’s plot.',
        'Your purchase and later construction save automatically on the server. A recovery download is optional and is not required to claim land.',
      ] },
      { id: 'sizes-costs', title: 'Plot sizes and expansion costs', paragraphs: [
        'Use Your land → Manage plot → Expand while near your own plot. Expansion is unavailable during a capture challenge. It adds buildable area within the reserved parcel, keeping your existing buildings in place.',
        'An upgrade also charges the difference between the old and new upkeep rates for your remaining prepaid time, rounded up to a whole coin. The listed expansion price is therefore a starting price; bring the required materials as well.',
      ], table: { headers: ['Buildable area', 'Weekly upkeep', 'Purchase or expansion'], rows: FRONTIER.sizes.map((size, tier) => [
        `${size} × ${size} tiles`,
        `${FRONTIER.taxes[tier]} coins`,
        tier === 0 ? `${claimPrice} coins, including the first week` : `${FRONTIER.upgradeCoins[tier - 1]} coins + ${tier === 1 ? '10 Planks + 10 Stone' : '20 Planks + 20 Bricks'} + prepaid upkeep adjustment`,
      ]) } },
      { id: 'pay-upkeep', title: 'Keep your home protected', paragraphs: [
        `Your land shows when upkeep is paid through and the cost of Pay a week. You can prepay up to ${FRONTIER.maxPrepay / WEEK} weeks ahead. The owner or a helper with Pay upkeep access pays from their own coins.`,
        `When paid time ends, a ${FRONTIER.grace / DAY}-day grace period begins. After grace ends, the plot becomes vulnerable to a challenge. Missing a payment does not immediately transfer your home.`,
        `A late renewal charges every started unpaid week plus the new week you buy. For example, renewing a starter plot one day after its paid time ends costs ${FRONTIER.taxes[0] * 2} coins: ${FRONTIER.taxes[0]} for the unpaid week and ${FRONTIER.taxes[0]} for the next week.`,
        'Paying the required renewal before capture completes cancels an announced or active challenge and returns the challenger’s full deposit. Check notices in Quests and the warning in Your land if someone challenges your home.',
      ], table: { headers: ['Status', 'Meaning'], rows: [
        ['Protected', 'Upkeep is paid; another player cannot start a capture challenge'],
        ['Grace', `Upkeep expired less than ${FRONTIER.grace / DAY} days ago; renew before the plot becomes vulnerable`],
        ['Vulnerable', 'Grace ended; an eligible player may announce a challenge'],
        ['Announced', `A challenge is scheduled, with ${FRONTIER.notice / DAY} day of notice`],
        ['Contested', 'The capture window is open; renewal can still cancel it before capture completes'],
      ] } },
      { id: 'trusted-helpers', title: 'Give a neighbour access', paragraphs: [
        'Under Your land → Manage plot → Give someone access, choose a known character and a permission. Up to eight helpers can have access. You remain the owner and can revoke access; permissions are frozen during a challenge.',
        'Build allows construction, moving and dismantling pieces, using your workstations and tending planters. Storage allows chest deposits and withdrawals. Pay upkeep allows a helper to fund renewal. All permissions combines those roles.',
        'Doors and gates let the owner and helpers with Build or Storage access enter. Characters already inside can leave. The game also rejects solid building placements that would trap a character.',
        'To leave a plot voluntarily, empty its storage, dismantle every building and use Abandon empty plot. You cannot abandon it during a challenge.',
      ] },
      { id: 'capture', title: 'How a capture challenge works', bullets: [
        'The challenger must have completed Tools of the trade, own no plot and have no other challenge underway. They must visit a vulnerable plot whose capture cooldown has ended.',
        `Announcing a challenge deposits one week of that plot’s upkeep and gives the owner ${FRONTIER.notice / DAY} day of notice. After that, the capture window lasts ${FRONTIER.window / 60_000} minutes.`,
        `During the window, the challenger must stay alive and online within one tile of the marker for ${FRONTIER.hold / 60_000} uninterrupted minutes. An enrolled defender beside the marker resets that hold. Leaving, dying or disconnecting also interrupts it.`,
        'Each side can have up to four participants. The challenger may invite three attackers; the owner and trusted helpers with Build access can join the defense. Joining makes combat possible against the opposing side in the active plot contest.',
        'While challenged, construction, moving, dismantling, expansion, abandoning and permission edits are frozen. The owner or treasurer can still pay the renewal and cancel the challenge before capture.',
        `If the capture window ends without success, half the deposit is returned, rounded down. Another challenge must wait ${FRONTIER.cooldown / DAY} day. The world owner can pause captures for maintenance.`,
      ] },
      { id: 'capture-loss', title: 'What changes when a plot is captured', paragraphs: [
        'The plot, its placed buildings and its on-plot chest contents pass to the successful challenger. Previous helper permissions are cleared. The capture deposit covers the new owner’s first week.',
        'The previous owner keeps their personal town vault, boats, companions, character skills and coins. Supplies left in a plot chest transfer with that plot, so use the personal vault for a small reserve you want to keep separate from land ownership.',
      ] },
      { id: 'character-access', title: 'Automatic saving and optional character recovery', paragraphs: [
        'Game progress is saved on the server. You do not need to export a file to save coins, land or buildings. Returning with the same browser login reconnects you to that character.',
        'An optional recovery key restores access to that existing guest character if the browser login is lost or you want to use another device. Open Settings → Your character → Restore access on another browser, then Download recovery key or Use a recovery key. Keep the file private because it grants character access; it is not a copy of the world or a manual progress save.',
        'Restore using a recovery file for the same world. Recovery issues a replacement key, so keep the new file. Creating a replacement recovery file invalidates the previous one. Server saving alone does not sign another browser into your guest character.',
      ] },
    ],
    related: ['meadows', 'coins-quests', 'building-storage', 'connection-identity'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/model.ts', 'shared/sim/frontier/engine.ts', 'frontend/src/frontier/FrontierPanel.tsx', 'frontend/src/Components/CharacterRecovery.tsx', 'frontend/src/frontier/recovery.ts', 'spacetimedb/src/reducers/frontier.ts'],
  },
  {
    slug: 'building-storage',
    title: 'Building & storage',
    category: 'Skills & activities',
    summary: 'Place and move modular pieces, build a workshop, grow carrots and manage chests or your town vault.',
    lead: `Build on a plot you own or where a neighbour has given you Build access. Choose a piece, preview its position and confirm placement to spend materials. ${availability}`,
    facts: [
      { label: 'Construction limit', value: `${FRONTIER.maxPieces} pieces per plot` },
      { label: 'Storage chest', value: '12 inventory slots' },
      { label: 'Personal town vault', value: '6 inventory slots' },
      { label: 'Dismantling refund', value: '75% per material, rounded down' },
    ],
    sections: [
      { id: 'first-shelter', title: 'Build your first shelter', bullets: [
        'Walk near your plot. Open Your land → Build on this plot and choose a piece you have the materials for. Unavailable pieces explain the missing supplies or discipline requirement.',
        'Tap a tile inside your buildable boundary to position the preview. Rotate it if needed and choose Build here. Red or invalid previews explain why placement is blocked.',
        `For the first shelter quest, place a Timber floor, a Timber wall and a Thatched roof. Their total base cost is ${cost({ timber: PIECES.floor.cost.timber + PIECES.wall.cost.timber + PIECES.roof.cost.timber, fibre: PIECES.roof.cost.fibre })}. Return to the steward to complete Under your own roof.`,
        'Keep a clear entrance with a Door or Gate. Your first Workbench, Storage chest and Cooking station make the plot useful beyond shelter.',
      ] },
      { id: 'placement-rules', title: 'Placement, moving and dismantling', paragraphs: [
        `A plot can hold up to ${FRONTIER.maxPieces} pieces. Each tile has a floor layer, a structure layer and a roof layer; pieces on different layers can share a tile. Two pieces on the same layer cannot. You cannot place a piece on a character or creature, outside the active plot boundary or where a solid piece would trap a character.`,
        'Use Placed pieces → Move to choose a new position for an existing piece without paying its material cost again. Moving a planter moves its crop with it. Building, moving and dismantling require Build access and a nearby character, and are frozen during a capture challenge.',
        'Dismantle returns 75% of each construction material, rounded down separately. For example, a Timber wall made from three Timber returns two Timber. Empty a chest before dismantling it. Dismantling a planter also removes the crop growing in it.',
      ] },
      { id: 'piece-reference', title: 'Building pieces and base costs', table: { headers: ['Piece', 'Materials', 'Role or requirement'], rows: Object.entries(PIECES).map(([id, piece]) => [
        piece.name,
        cost(piece.cost),
        piece.discipline !== undefined ? `${DISCIPLINES[piece.discipline]} level ${piece.level ?? 1}, active` : id === 'chest' ? '12-slot plot storage' : id === 'planter' ? 'Grow one carrot crop' : piece.station ? `Station: ${piece.station}` : piece.layer === 'floor' ? 'Floor layer' : piece.layer === 'roof' ? 'Roof layer' : piece.solid ? 'Blocks walking' : 'Passable structure layer',
      ]) } },
      { id: 'workstations', title: 'Use public or private workstations', paragraphs: [
        'The town square provides public access to ordinary workstation recipes. At your own plot, stand beside a matching station on a plot where you have Build access. Workbench, Kiln and Cooking station recipes then become available in Workshop when you have the ingredients and any required active discipline.',
        'Skiff hulls use a harbour station, so take their materials to the shipwright. A stable supports keeping additional creatures; it is built from eight Planks and four Rope. Later recipes and Brick walls can require Building as an active discipline.',
      ] },
      { id: 'storage', title: 'Put supplies in storage', paragraphs: [
        'Open More → Bag & storage, choose Storage and set the quantity. Deposit moves that amount from your bag into the selected container; Withdraw brings stored items back. Both destinations need enough inventory space.',
        'Your personal town vault holds six slots and is usable while you are in the Meadows town square. Only your character can access it. It remains yours if you lose a plot.',
        'Each Storage chest holds twelve slots. Walk beside it and use the owner’s or a helper’s Storage access. A chest and its contents belong to the plot and transfer if that plot is captured.',
        'Boat cargo and trained pack-creature storage appear through the same storage controls when available. They have their own location and access requirements; plot permissions do not grant boat cargo access.',
      ] },
      { id: 'planters', title: 'Grow carrots in a planter', paragraphs: [
        'Build a Planter, bring a Carrot seed and stand beside it. Choose Plant carrot seed under the placed planter. One seed fills the planter with one crop. Seeds can come from a Burrowbun’s ability or Reedwake resource patches.',
        'Carrots take two hours to ripen, or ninety minutes if you carry a Watering can when you plant. Growth continues while you are away. Harvest gives three Carrots; active Cultivation at level 2 increases that to four. Planting gives 8 Cultivation XP and harvesting gives 20.',
        'Use Carrots as food or combine them with Strawberries into Travel rations at a Cooking station or the public workshop. This planter system is separate from the personal berry garden near the Grove camp.',
      ] },
    ],
    related: ['land-ownership', 'coins-quests', 'meadows', 'frontier-materials-crafting', 'frontier-disciplines', 'wildlife-companions', 'garden', 'inventory-items'],
    sourceFiles: ['shared/sim/frontier/catalog.ts', 'shared/sim/frontier/engine.ts', 'frontend/src/frontier/FrontierPanel.tsx', 'frontend/src/frontier/FrontierWorld.tsx'],
  },
];
