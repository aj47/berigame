import type { WikiArticle } from './wikiContent';

export interface ChangelogEntry {
  id: string;
  /** Calendar date in America/Los_Angeles; ranges use their last day. */
  date: string;
  period: string;
  title: string;
  note?: string;
  changes: string[];
  /** Evidence for backfilled notes. Keep these when editing historical entries. */
  commits: string[];
}

/** Add new player-facing updates at the top. Only claim a release when verified. */
export const changelogEntries: ChangelogEntry[] = [
  {
    id: '2026-10-02-connected-meadows', date: '2026-10-02', period: 'Oct 2, 2026',
    title: 'A connected Meadows and clearer next steps',
    note: 'Prepared in the local preview; this is not a public release announcement. Settlement features require the world owner to enable the expansion.',
    changes: [
      'Walk from Bramblewild along the east harbour trail into the Meadows, with matching trees, terrain and smaller object labels. Land hovering and navigation continue across the district boundary.',
      'The Meadows menu starts with Quests, Your land and Workshop. Wildlife, Disciplines, Sailing and Bag & storage sit under More, while plot names and claim costs are easier to read.',
      'District maps make landmarks readable on desktop and phone screens. Six marked timber pines offer a gathering route; the crafted Axe yields two Timber and both count toward quests. Camera movement preserves interactions queued for arrival.',
      'World object panels open after your character approaches. Timber gathering takes time: the character chops, the tree falls, a stump remains, and the tree regrows. Materials arrive when the action completes.',
      'Hide tips with their × control, or manage tips, world labels and nameplates in Settings.',
      'Progress, coins and land save automatically on the server. Buying land no longer requires a recovery download; optional character-access recovery is in Settings.',
      'Eight new wiki guides cover the Meadows, coins and quests, land and upkeep, building and storage, materials and recipes, wildlife, disciplines and sailing. Item pages and the original guides now link to those systems.',
    ],
    commits: [],
  },
  {
    id: '2026-10-02-everyday-adventures', date: '2026-10-02', period: 'Oct 2, 2026',
    title: 'Easier everyday adventures',
    note: 'Live beta update',
    changes: [
      'Shorter adventure, crafting, skills and settings menus. The berry delivery destination is now clearly named Berry drop-off.',
      'Found weapons stay in your bag. Drag items to move, merge or swap them, including between the bag and quick slots.',
      'Pick up items underneath players and trade weapons while they are wielded.',
      'Add friends from Chat and manage them in its Friends tab, with online status, Go to, Mute and Remove controls.',
      'Feeding the expedition Giant brings bonus Goldberries, a first-feast Berry Heart keepsake and friendship rewards that give expeditions you start a head start.',
      'The wiki now covers all 36 items and includes this changelog, backfilled to the first island prototype.',
    ],
    commits: ['7526a16', '5acf3f7'],
  },
  {
    id: '2026-10-02-settlements', date: '2026-10-02', period: 'Oct 2, 2026',
    title: 'Settlements and sailing prepared',
    note: 'Disabled in the hosted beta. These features become playable when the world owner enables settlements.',
    changes: [
      'Land claims, building, quests, coins and five disciplines lay the foundations for settlements.',
      'Skiffs, new islands, creature companions and 25 new items expand what you can explore and make.',
      'Optional character recovery restores access to an existing character; world progress is saved on the server.',
    ],
    commits: ['7526a16'],
  },
  {
    id: '2026-10-01-wiki', date: '2026-10-01', period: 'Oct 1, 2026',
    title: 'A home for the island and its stories',
    changes: [
      'A new public home introduces the island with a trailer and interactive scenery.',
      'The player wiki adds searchable guides, dedicated item pages and a crafting recipe planner.',
      'Browse the site and wiki without starting a game session.',
    ],
    commits: ['8c3036e'],
  },
  {
    id: '2026-10-01-character-and-controls', date: '2026-10-01', period: 'Oct 1, 2026',
    title: 'Make your character, find your way',
    changes: [
      'Create your character before entering, with more hairstyles, colors, accessories and starter looks.',
      'Smaller, translucent panels keep more of the island visible. Crafting gets its own menu.',
      'Choose between overlapping players, use Walk here beneath objects and approach trade partners automatically.',
      'Harvest countdowns stay current, and selecting the Berry Giant opens focused interaction controls.',
    ],
    commits: ['5375532', 'ada3668', 'ab95f35', 'fe69123', '5b2cfd8', 'e5f2745', '9a2aa5f', 'a1a45e8', 'dc891ef'],
  },
  {
    id: '2026-09-30-open-beta', date: '2026-09-30', period: 'Sep 30, 2026',
    title: 'Open beta and enormous berries',
    changes: [
      'Enter the open beta without an invite code.',
      'Grow a giant berry and deliver it or bring it to a woodland feast. Carry, roll, hide and share the cargo with help from Moss.',
      'Outwit Pip and the Giant, unlock techniques across five paths, practice friendly duels and help build the shared workshop.',
      'Earn your first Stick at Foraging level 2, with extra time to learn your first expedition.',
    ],
    commits: ['6ffc87f'],
  },
  {
    id: '2026-09-29-gardens-and-giants', date: '2026-09-29', period: 'Sep 29, 2026',
    title: 'Gardens, raids and a helping hand',
    changes: [
      'Plant a personal berry garden that keeps growing while you are away.',
      'Join scheduled Giant raids, with countdowns and rewards for contributors.',
      'Earn keepsakes by helping newcomers reach important milestones.',
    ],
    commits: ['9010139', '393ee4c', '478b7aa'],
  },
  {
    id: '2026-09-29-progress-and-company', date: '2026-09-29', period: 'Sep 28–29, 2026',
    title: 'Progress and company',
    changes: [
      'Train Foraging, Beachcombing and Crafting to unlock recipes and keepsakes.',
      'Reach the Boulders, gather Obsidian and face the Giant.',
      'Invite friends, manage chat and exchange items through confirmed trades.',
      'Return to your saved character. Automatic reconnection helps when a connection drops.',
    ],
    commits: ['3b34c2d', 'df0f37a', 'a27377e', '985d301', 'a718364', '1b01645'],
  },
  {
    id: '2026-09-28-coast', date: '2026-09-28', period: 'Sep 28, 2026',
    title: 'Beyond the Grove',
    changes: [
      'Find a Stick, cross the brambles and gather Driftwood and Flint on the Coast.',
      'Craft a Stone Club and use three quick slots for food and weapons. Punches and wielded weapons replace the old combat stances.',
      'First-day goals, a safe starting ring and newcomer protection help players learn.',
      'New scenery, smoother characters and more combat animations bring the island to life.',
    ],
    commits: ['aa8f361', 'bef9bcf', '0d729ac', '6ab9b74', '6dcdbff', '0358ba7', 'fb1ec61'],
  },
  {
    id: '2026-09-22-hosted-beta', date: '2026-09-22', period: 'Sep 22, 2026',
    title: 'The beta goes online',
    changes: [
      'An invite-only beta brings browser players and agents into the same persistent world.',
      'Agent onboarding and an HTTP API provide another way to explore the island.',
    ],
    commits: ['5952a9d', '6d0a245'],
  },
  {
    id: '2026-09-21-rebuilding', date: '2026-09-21', period: 'Sep 18–21, 2026',
    title: 'Rebuilding the multiplayer world',
    changes: [
      'Movement, combat, harvesting and inventory move onto a shared server simulation.',
      'Customizable low-poly adventurers arrive with responsive controls, smoother movement and clearer combat feedback.',
    ],
    commits: ['c3a7c8d', '5e4ae7e', 'b895bbc'],
  },
  {
    id: '2025-06-28-combat-and-berries', date: '2025-06-28', period: 'Jun 24–28, 2025',
    title: 'Steadier fights and fewer lost berries',
    changes: [
      'Improve attack timing, combat feedback and movement after respawning.',
      'Prevent duplicate harvest rewards and make eating remove one berry from a stack.',
    ],
    commits: ['6fa7733', 'c77f7fc', '7675ad4', 'f416c9f'],
  },
  {
    id: '2025-06-22-harvest-and-bag', date: '2025-06-22', period: 'Jun 11–22, 2025',
    title: 'A working harvest and bag',
    changes: [
      'Timed harvesting awards berries, and defeated players return to the island.',
      'Four berry varieties restore different amounts of health.',
      'Move items around the bag, drop them, collect ground items and eat berries.',
      'A loading screen introduces the island while it connects.',
    ],
    commits: ['c98445b', 'c2a02d1', '0e6b062', '98e6ed6', '3c1c85d', 'fb4adc6', '840267e'],
  },
  {
    id: '2023-first-island', date: '2023-09-04', period: 'Feb–Sep 2023',
    title: 'The first island prototype',
    changes: [
      'Multiplayer avatars, chat and action menus establish the first shared island.',
      'Follow and Attack actions, damage numbers and health bars provide early interaction.',
      'Inventory shortcuts and more trees begin shaping the interface. Harvesting and bag contents are still prototypes at this stage.',
    ],
    commits: ['76fd382', '9ecc717', 'c19abcd', '9540f86', 'b7aae82', '656156d', 'edd33d6', '9aa1db5', 'ecf8d8d'],
  },
];

export const latestUpdate = changelogEntries[0];

export const changelogArticle: WikiArticle = {
  slug: 'changelog', title: 'Changelog', category: 'Updates',
  summary: 'New adventures, useful fixes and the story of how the island grew.',
  lead: 'The latest changes come first. Older entries are backfilled from project history, so their dates may differ from when they reached the live game. Dates use Pacific time; early work is grouped into milestones.',
  sections: changelogEntries.map(entry => ({
    id: entry.id,
    title: `${entry.period} · ${entry.title}`,
    paragraphs: entry.note ? [entry.note] : undefined,
    bullets: entry.changes,
  })),
  related: ['getting-started', 'controls', 'meadows', 'coins-quests', 'land-ownership', 'connection-identity'],
  sourceFiles: ['frontend/src/site/changelog.ts'],
};
