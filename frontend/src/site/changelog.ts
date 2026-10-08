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
    id: '2026-10-08-the-journey', date: '2026-10-08', period: 'Oct 8, 2026',
    title: 'The map and goal chip now lead all the way to the Sunken Spire',
    changes: [
      'After your Stone Club, the goal chip keeps going: gather 3 obsidian in the Boulders, defeat Clatterhorn for gleamshell, make a Spire Key and descend the Sunken Spire. It no longer sends you back to the camp in a loop once you hold obsidian.',
      'The map shows the whole road as five chapters, Grove, Coast, Boulders, Clatterhorn’s Glade and the Sunken Spire, with your current one highlighted. Tap a chapter to walk there.',
      'A gold ring on the small and large map marks where your current goal leads.',
      'After a defeat, the goal chip offers to walk you back to your dropped bag when you can still reach it.',
      'Agents get the same road in state.goal, now with a target tile and chapter.',
    ],
    commits: [],
  },
  {
    id: '2026-10-05-clatterhorn-and-the-sunken-spire', date: '2026-10-05', period: 'Oct 5, 2026',
    title: 'Clatterhorn scuttles in a new southern glade; the Sunken Spire opens under the inland sea',
    changes: [
      'Clatterhorn, a cart-sized stag beetle, wakes in Clatterhorn’s Glade at (84, 106) in the southern wilds when you step in. It charges whoever stands farthest away along a marked lane; lure it into one of the eight standing stones and it flips onto its back, taking double damage.',
      'Hug Clatterhorn to dodge its Shell Spin, and step into the green free columns when it drums up a swarm of runners. Its health grows with every challenger, and every helper with a recent swing earns gleamshell, goldberries, Fighting XP and the Clatterhorn Horn keepsake.',
      'The Sunken Spire Gate stands at (62, 45) on the Boulders’ east cliff. Parties of one to four descend with a Spire Key each, made from 3 obsidian and 1 gleamshell, to face the Shardmother’s rings, fans, walls and curtains of shards across four phases.',
      'Walk onto falling stars to damage the Shardmother, and stand near the heart to swing your weapon automatically. Red and amber tiles and green dodge-assist dots show where the shards will be; step with WASD, the arrow keys or the touch pad.',
      'Dropping to zero HP in the Spire knocks you out to the gate with your bag untouched. A clear pays goldberries, a Prism Shard and Fighting XP and unlocks the Prism Crown; a clear without a hit adds the Shard Pendant, and five shards make the Shard Circlet.',
      'Agents can fight both bosses through GET /danger and the attack_clatterhorn, spire and dodge actions.',
    ],
    commits: ['31c0ecb', 'b71ef5b', '501b0c2', '627eb8f', '11df126', '75cf224', '93fe0bc', '99af47c', '33d7f06', '2e86c0d'],
  },
  {
    id: '2026-10-05-homes-and-outer-lands', date: '2026-10-05', period: 'Oct 5, 2026',
    title: 'Roomier homes, joined roofs and a Bramblewild four times larger',
    note: 'Live beta update.',
    changes: [
      'Walls stand taller than your character, and neighbouring roof tiles on a plot join into one roof with ridges, valleys and overhanging eaves.',
      'Every building piece has new detailed art, and beds, benches, stools, bookshelves, barrels, woven rugs and potted plants join the build list.',
      'Press R (Shift+R to go back) to turn a piece while placing it; an arrow on the preview shows which way it faces. Placed pieces can be rotated where they stand.',
      'The Coast continues past the harbour road into Eastreach and over Saltmarsh Causeway into Mossvale and the southern wilds, with lakes, woods and six new destinations on the map.',
      'Forty-one berry thickets and twenty-six driftwood piles and tide rocks now dot the shores, including new thickets on the original Coast. The harbour trail to the Meadows crosses Eastreach.',
      'The Meadows gains seventy-three wild timber, stone, fibre, clay and berry patches between the plots, in the eastern woods and along both shores.',
    ],
    commits: [],
  },
  {
    id: '2026-10-05-menus-crafting-drop', date: '2026-10-05', period: 'Oct 5, 2026',
    title: 'Menus open where you click, a sorted crafting panel and drag to drop',
    note: 'Live beta update.',
    changes: [
      'Clicking a tree, ground pile, garden plot, adventure prop or creature opens its menu straight away. The action you choose walks you over first, so you can change your mind before moving.',
      'Meadows timber pines, rocks and plants open the same kind of menu as island berry trees, with one Chop, Mine, Harvest or Gather action that shows who is already gathering or the regrowth countdown.',
      'Craft groups recipes into Gear, Food, Tools and Materials. Use Ready to see only what your bag can make now; each group shows how many of its recipes are ready, and level-locked recipes stay at the bottom in a compact card.',
      'In Bramblewild, drag an item out of the bag or a quick slot and release it over the island to drop the whole stack.',
    ],
    commits: ['57b78a9', '8bbfaa6', 'f9699d3', '38adf72', '7cb6500'],
  },
  {
    id: '2026-10-05-player-accounts', date: '2026-10-05', period: 'Oct 5, 2026',
    title: 'Save your character and return from another browser',
    note: 'Live beta update — player accounts are enabled.',
    changes: [
      'Save your current character from Settings → Account by linking Discord, Google, email or a passkey. Accounts are created when you save a character.',
      'Choose “Saved your character? Log in” on the title screen to return to that same character from another browser. Email offers both a sign-in link and a six-digit code.',
      'Manage linked sign-ins and log out in Settings → Account. Your character keeps the same game identity and server-saved progress.',
    ],
    commits: [],
  },
  {
    id: '2026-10-03-discord-links', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'Join the BeriGame community on Discord',
    changes: [
      'Join Discord from the website, wiki or in-game menu. The invite opens the welcome channel and does not expire.',
      'The bug-report panel includes a way to join the server alongside the direct feedback channel link.',
    ],
    commits: [],
  },
  {
    id: '2026-10-03-community-feedback', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'A clearer bank, right-drag camera and permanent island rewards',
    changes: [
      'Open Bank from your bag to store loot safely in Meadows town. Personal banks now hold 48 slots, preserve existing items, and offer walking directions, item icons and stack transfers.',
      'Right-drag rotates the desktop camera. Left click remains available for movement and actions; touch controls and zoom stay familiar.',
      'Skip the discipline-switch wait for 50 coins total (20 normal plus 30 extra). The first pair remains free, and switching after 24 hours still costs 20 coins.',
      'Restore the Reedwake Tide Shrine and Cinder Ember Shrine with materials. Each permanently adds 5% to your character’s discipline XP gains, up to 10% total.',
      'The bag clearly marks equipped armour and shows Equip or Unequip in every region.',
      'Menu → Report a bug prepares a shareable report with build, connection, tick timing and movement diagnostics. Reports stay local until you copy or download them to share.',
    ],
    commits: ['2ce5916'],
  },
  {
    id: '2026-10-03-meadows-icons', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'New artwork for every Meadows item',
    changes: [
      'All 25 Meadows materials, tools, provisions, boat parts and equipment now have illustrated icons matching the original berries and island artwork.',
      'The new artwork appears throughout the bag, quick slots, crafting, storage and trading, and on the wiki item pages.',
    ],
    commits: ['4452505'],
  },
  {
    id: '2026-10-03-controls-building-travel', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'Familiar controls, better building and quicker travel',
    changes: [
      'Keep the same bag, crafting menu and three quick slots in every district. Recipes show item icons, ingredient counts and nearby station requirements; storage and trading remain available from the bag.',
      'Click or tap any dry location on the expanded map to walk there, including across the harbour trail between Bramblewild and the Meadows.',
      'Click players in the Meadows to open the familiar Attack, Follow and Trade menu. Attack follows a moving opponent into range and keeps swinging until stopped; protected locations explain why combat is unavailable.',
      'Equip or remove a Padded vest from the bag or a quick slot. Equipped armour clearly shows its three-point maximum-health bonus.',
      'Place walls, windows, doors, fences and gates along floor edges. Rotate to choose a side, combine several sides on one floor, and walk across the floor space inside. Existing buildings keep their positions until moved.',
      'Floors, walls, doors and roofs remain visible in the building menu when materials are missing, with the required materials shown.',
      'Walk faster while travelling peacefully and sail skiffs twice as fast. Carrying giant berries and fighting retain their movement limits; Exploration level 10 improves sailing further.',
      'Blocked routes describe obstacles and closed gates, with tool hints only when a progression boundary actually blocks the route. Completed feasts share one visible Giant instead of piling Giants into the same spot.',
      'The Giant is easier to click, and the optional One-click attack toggle attacks eligible targets directly. Giant raids now begin every 20 minutes.',
    ],
    commits: ['252507f', '5e84623', '02c12c4', '507e714', 'c16c3da'],
  },
  {
    id: '2026-10-03-blueberry-icon', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'The blueberry becomes the game icon',
    note: 'Branding update',
    changes: [
      'The in-game blueberry now appears in browser tabs, touch icons and website and wiki branding.',
      'A matching transparent PNG is available at https://berigame.com/icon.png.',
    ],
    commits: ['63584ab'],
  },
  {
    id: '2026-10-03-agent-friendly-wiki', date: '2026-10-03', period: 'Oct 3, 2026',
    title: 'A wiki agents can read directly',
    note: 'Wiki update',
    changes: [
      'Every wiki article now has a Markdown version, with a JSON article index and a complete text export generated from the same guides.',
      'The For agents links introduce the reference and point to the live API guide and schema. Open exported documents in the wiki reader and copy their text or URL.',
      'Agents can request Markdown directly from article URLs. The wiki also publishes crawler discovery files and returns a clear missing-document response for unknown exports.',
    ],
    commits: ['464d501'],
  },
  {
    id: '2026-10-02-connected-meadows', date: '2026-10-02', period: 'Oct 2, 2026',
    title: 'A connected Meadows and clearer next steps',
    note: 'Live beta update — Meadows settlements are enabled.',
    changes: [
      'Walk from Bramblewild along the east harbour trail into the Meadows, with matching trees, terrain and smaller object labels. Land hovering and navigation continue across the district boundary.',
      'The Meadows menu starts with Quests, Your land and Workshop. Wildlife, Disciplines, Sailing and Bag & storage sit under More, while plot names and claim costs are easier to read.',
      'District maps make landmarks readable on desktop and phone screens. Six marked timber pines offer a gathering route; the crafted Axe yields two Timber and both count toward quests. Camera movement preserves interactions queued for arrival.',
      'World object panels open after your character approaches. Timber gathering takes time: the character chops, the tree falls, a stump remains, and the tree regrows. Materials arrive when the action completes.',
      'Hide tips with their × control, or manage tips, world labels and nameplates in Settings.',
      'Progress, coins and land save automatically on the server. Buying land no longer requires a recovery download; optional character-access recovery is in Settings.',
      'Eight new wiki guides cover the Meadows, coins and quests, land and upkeep, building and storage, materials and recipes, wildlife, disciplines and sailing. Item pages and the original guides now link to those systems.',
    ],
    commits: ['a5433ec'],
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
    note: 'Initially prepared behind the expansion flag; enabled in the connected Meadows update above.',
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
  related: ['getting-started', 'clatterhorn', 'sunken-spire', 'player-accounts', 'controls', 'meadows', 'coins-quests', 'land-ownership', 'connection-identity'],
  sourceFiles: ['frontend/src/site/changelog.ts'],
};
