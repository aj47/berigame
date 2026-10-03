/** Settlements expansion tuning. Stable IDs are persisted: never reuse them. */
export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
export const FRONTIER = {
  deed: 20,
  taxes: [30, 60, 100],
  sizes: [8, 12, 16],
  upgradeCoins: [100, 250],
  grace: 3 * DAY,
  notice: DAY,
  window: 600_000,
  hold: 120_000,
  cooldown: DAY,
  maxPrepay: 4 * WEEK,
  maxPieces: 128,
  repeatCap: 60,
  switchCost: 20,
  switchCooldown: DAY,
  gatherDuration: 3000,
  timberRegrow: 12000,
} as const;
export const DISCIPLINES = [
  "Might",
  "Cultivation",
  "Building",
  "Beastcraft",
  "Exploration",
] as const;
export type RegionId =
  "bramblewild" | "settlement" | "reedwake" | "cinder" | "sea";
export type Point = { x: number; z: number };
export type Location = Point & { region: RegionId };
export const REGIONS: Record<
  RegionId,
  { name: string; size: number; spawn: Point; color: string }
> = {
  bramblewild: {
    name: "Bramblewild",
    size: 64,
    spawn: { x: 25, z: 25 },
    color: "#82a568",
  },
  settlement: {
    name: "Bramblewild Meadows",
    size: 128,
    spawn: { x: 31, z: 64 },
    color: "#669548",
  },
  reedwake: {
    name: "Reedwake",
    size: 128,
    spawn: { x: 5, z: 64 },
    color: "#8bb9a0",
  },
  cinder: {
    name: "Cinder Shoal",
    size: 128,
    spawn: { x: 5, z: 64 },
    color: "#a49687",
  },
  sea: {
    name: "The Open Sea",
    size: 128,
    spawn: { x: 8, z: 64 },
    color: "#438eaa",
  },
};
export const PORTS = [
  { region: "bramblewild" as RegionId, x: 46, z: 29, sea: { x: 8, z: 64 } },
  { region: "reedwake" as RegionId, x: 5, z: 64, sea: { x: 100, z: 15 } },
  { region: "cinder" as RegionId, x: 5, z: 64, sea: { x: 105, z: 108 } },
];
export const PLOTS = (["settlement", "reedwake", "cinder"] as const).flatMap(
  (region) =>
    Array.from({ length: region === "settlement" ? 24 : 12 }, (_, i) => ({
      id: `${region}-${i + 1}`,
      region,
      x: 12 + (i % 4) * 24,
      z: 8 + Math.floor(i / 4) * 19,
      marker: { x: 11 + (i % 4) * 24, z: 8 + Math.floor(i / 4) * 19 },
    })),
);
export const MATERIALS: Record<
  string,
  { name: string; color: string; stack?: number }
> = {
  timber: { name: "Timber", color: "#96704c" },
  stone: { name: "Stone", color: "#8b929a" },
  fibre: { name: "Plant fibre", color: "#a6b570" },
  clay: { name: "Clay", color: "#c18460" },
  reeds: { name: "Reeds", color: "#bcc077" },
  resin: { name: "Resin", color: "#d8a347" },
  iron_ore: { name: "Iron ore", color: "#757983" },
  planks: { name: "Planks", color: "#c19161" },
  rope: { name: "Rope", color: "#c4ad80" },
  cloth: { name: "Cloth", color: "#e6debb" },
  bricks: { name: "Bricks", color: "#be806b" },
  iron_fittings: { name: "Iron fittings", color: "#637885" },
  axe: { name: "Axe", color: "#9daaaa", stack: 1 },
  pick: { name: "Pick", color: "#929caa", stack: 1 },
  hammer: { name: "Hammer", color: "#959c9d", stack: 1 },
  watering_can: { name: "Watering can", color: "#83a9ad", stack: 1 },
  taming_feed: { name: "Taming feed", color: "#bfb06c" },
  travel_rations: { name: "Travel rations", color: "#cb9363" },
  skiff_hull: { name: "Skiff hull", color: "#977452", stack: 1 },
  sail: { name: "Sail", color: "#f5ebce", stack: 1 },
  harness: { name: "Creature harness", color: "#956545", stack: 1 },
  carrot: { name: "Carrot", color: "#efab63" },
  carrot_seed: { name: "Carrot seed", color: "#bdc67b" },
  iron_club: { name: "Iron club", color: "#8896a0", stack: 1 },
  padded_vest: { name: "Padded vest", color: "#a48860", stack: 1 },
};
export type Cost = Record<string, number>;
export type Piece = {
  name: string;
  cost: Cost;
  layer: "floor" | "solid" | "roof";
  solid: boolean;
  /** New pieces mount on a tile boundary; rotation selects its side. */
  edge?: boolean;
  station?: string;
  discipline?: number;
  level?: number;
};
export const PIECES: Record<string, Piece> = {
  floor: {
    name: "Timber floor",
    cost: { timber: 2 },
    layer: "floor",
    solid: false,
  },
  wall: {
    name: "Timber wall",
    cost: { timber: 3 },
    layer: "solid",
    solid: true,
    edge: true,
  },
  window: {
    name: "Window wall",
    cost: { timber: 3 },
    layer: "solid",
    solid: true,
    edge: true,
  },
  door: {
    name: "Door",
    cost: { timber: 3, fibre: 1 },
    layer: "solid",
    solid: false,
    edge: true,
  },
  fence: { name: "Fence", cost: { timber: 2 }, layer: "solid", solid: true, edge: true },
  gate: {
    name: "Gate",
    cost: { timber: 2, fibre: 1 },
    layer: "solid",
    solid: false,
    edge: true,
  },
  roof: {
    name: "Thatched roof",
    cost: { timber: 1, fibre: 2 },
    layer: "roof",
    solid: false,
  },
  lamp: {
    name: "Lantern",
    cost: { clay: 2, fibre: 1 },
    layer: "solid",
    solid: false,
  },
  sign: { name: "Sign", cost: { timber: 1 }, layer: "solid", solid: false },
  chair: { name: "Chair", cost: { timber: 2 }, layer: "solid", solid: true },
  table: { name: "Table", cost: { timber: 4 }, layer: "solid", solid: true },
  planter: { name: "Planter", cost: { clay: 3 }, layer: "solid", solid: false },
  chest: {
    name: "Storage chest",
    cost: { timber: 4, stone: 2 },
    layer: "solid",
    solid: true,
    station: "storage",
  },
  workbench: {
    name: "Workbench",
    cost: { timber: 6, stone: 2 },
    layer: "solid",
    solid: true,
    station: "workbench",
  },
  kiln: {
    name: "Kiln",
    cost: { clay: 8, stone: 4 },
    layer: "solid",
    solid: true,
    station: "kiln",
  },
  kitchen: {
    name: "Cooking station",
    cost: { stone: 6, timber: 2 },
    layer: "solid",
    solid: true,
    station: "kitchen",
  },
  stable: {
    name: "Creature stable",
    cost: { planks: 8, rope: 4 },
    layer: "solid",
    solid: true,
    station: "stable",
  },
  brick_wall: {
    name: "Brick wall",
    cost: { bricks: 3 },
    layer: "solid",
    solid: true,
    edge: true,
    discipline: 2,
    level: 5,
  },
};
export type Recipe = {
  id: string;
  inputs: Cost;
  output: string;
  quantity: number;
  station?: string;
  discipline?: number;
  level?: number;
};
export const FRONTIER_RECIPES: Recipe[] = [
  { id: "planks", inputs: { timber: 2 }, output: "planks", quantity: 2 },
  { id: "rope", inputs: { fibre: 3 }, output: "rope", quantity: 1 },
  {
    id: "cloth",
    inputs: { fibre: 4 },
    output: "cloth",
    quantity: 1,
    station: "workbench",
  },
  {
    id: "bricks",
    inputs: { clay: 3, timber: 1 },
    output: "bricks",
    quantity: 3,
    station: "kiln",
  },
  {
    id: "iron_fittings",
    inputs: { iron_ore: 2, timber: 1 },
    output: "iron_fittings",
    quantity: 2,
    station: "kiln",
    discipline: 2,
    level: 5,
  },
  { id: "axe", inputs: { timber: 2, stone: 2 }, output: "axe", quantity: 1 },
  { id: "pick", inputs: { timber: 2, stone: 3 }, output: "pick", quantity: 1 },
  {
    id: "hammer",
    inputs: { timber: 1, stone: 2 },
    output: "hammer",
    quantity: 1,
  },
  {
    id: "watering_can",
    inputs: { clay: 3 },
    output: "watering_can",
    quantity: 1,
    station: "kiln",
  },
  {
    id: "taming_feed",
    inputs: { berry_greenberry: 2, fibre: 1 },
    output: "taming_feed",
    quantity: 2,
  },
  {
    id: "travel_rations",
    inputs: { carrot: 2, berry_strawberry: 1 },
    output: "travel_rations",
    quantity: 2,
    station: "kitchen",
  },
  {
    id: "skiff_hull",
    inputs: { planks: 20, rope: 6 },
    output: "skiff_hull",
    quantity: 1,
    station: "harbour",
  },
  {
    id: "sail",
    inputs: { cloth: 8, rope: 4 },
    output: "sail",
    quantity: 1,
    station: "workbench",
  },
  {
    id: "harness",
    inputs: { cloth: 2, rope: 2 },
    output: "harness",
    quantity: 1,
    discipline: 3,
    level: 2,
  },
  {
    id: "iron_club",
    inputs: { timber: 2, iron_fittings: 3 },
    output: "iron_club",
    quantity: 1,
    station: "workbench",
    discipline: 2,
    level: 5,
  },
  {
    id: "padded_vest",
    inputs: { cloth: 6, rope: 2 },
    output: "padded_vest",
    quantity: 1,
    station: "workbench",
  },
];
export const SPECIES = [
  {
    id: "burrowbun",
    name: "Burrowbun",
    color: "#d9bba0",
    region: "settlement",
    tameable: true,
    hint: "Walk within three tiles, observe, then approach slowly with taming feed.",
    utility: "Find a nearby seed cache.",
  },
  {
    id: "reedhorn",
    name: "Reedhorn",
    color: "#a9b884",
    region: "reedwake",
    tameable: true,
    hint: "Observe from three tiles away. Feed twice at close range.",
    utility: "Carry six cargo slots with a harness.",
  },
  {
    id: "glowmoth",
    name: "Glowmoth",
    color: "#ebd887",
    region: "reedwake",
    tameable: true,
    hint: "Observe its flight before offering feed.",
    utility: "Reveal the nearest resource patch.",
  },
  {
    id: "shellback",
    name: "Shellback",
    color: "#719b95",
    region: "cinder",
    tameable: true,
    hint: "Observe patiently, then offer taming feed.",
    utility: "Protect expedition cargo briefly.",
  },
  {
    id: "bristleback",
    name: "Bristleback",
    color: "#946f60",
    region: "cinder",
    tameable: false,
    hint: "Territorial. Approach with food and a weapon ready.",
    utility: "A hostile wildlife encounter.",
  },
] as const;
export type QuestDef = {
  id: string;
  title: string;
  text: string;
  event: string;
  amount: number;
  coins: number;
  handIn?: Cost;
};
export const QUESTS: QuestDef[] = [
  {
    id: "steward",
    title: "Meet the steward",
    text: "Visit the steward in the Meadows town square.",
    event: "steward",
    amount: 1,
    coins: 10,
  },
  {
    id: "supplies",
    title: "Local materials",
    text: "Gather six timber for the settlement.",
    event: "gather:timber",
    amount: 6,
    coins: 15,
  },
  {
    id: "tools",
    title: "Tools of the trade",
    text: "Craft a hammer.",
    event: "craft:hammer",
    amount: 1,
    coins: 25,
  },
  {
    id: "deed",
    title: "A place of your own",
    text: "Buy a deed at an available claim marker.",
    event: "claim",
    amount: 1,
    coins: 0,
  },
  {
    id: "shelter",
    title: "Under your own roof",
    text: "Place a floor, wall, and roof on your plot.",
    event: "shelter",
    amount: 1,
    coins: 0,
  },
  {
    id: "observe",
    title: "Quiet neighbours",
    text: "Observe a wild creature.",
    event: "observe",
    amount: 1,
    coins: 10,
  },
  {
    id: "feed",
    title: "A favourite meal",
    text: "Craft taming feed.",
    event: "craft:taming_feed",
    amount: 1,
    coins: 10,
  },
  {
    id: "tame",
    title: "A new friend",
    text: "Befriend a creature.",
    event: "tame",
    amount: 1,
    coins: 10,
  },
  {
    id: "order",
    title: "Useful work",
    text: "Complete an NPC supply order.",
    event: "order",
    amount: 1,
    coins: 10,
  },
  {
    id: "upkeep",
    title: "Plan for next week",
    text: "Earn and prepay a second week of tax.",
    event: "upkeep",
    amount: 1,
    coins: 0,
  },
  {
    id: "stable",
    title: "Room for friends",
    text: "Build a stable.",
    event: "build:stable",
    amount: 1,
    coins: 10,
  },
  {
    id: "adventure",
    title: "Help the camp",
    text: "Deliver six planks to the camp steward.",
    event: "handin",
    amount: 1,
    coins: 10,
    handIn: { planks: 6 },
  },
  {
    id: "shipwright",
    title: "The shipwright",
    text: "Visit Driftwood Harbour and speak to the shipwright.",
    event: "shipwright",
    amount: 1,
    coins: 10,
  },
  {
    id: "hull",
    title: "A sound hull",
    text: "Craft a skiff hull at the harbour.",
    event: "craft:skiff_hull",
    amount: 1,
    coins: 10,
  },
  {
    id: "boat",
    title: "Launch day",
    text: "Assemble and launch your skiff.",
    event: "boat",
    amount: 1,
    coins: 10,
  },
  {
    id: "provisions",
    title: "Prepare for the crossing",
    text: "Deposit food in the boat cargo.",
    event: "provisions",
    amount: 1,
    coins: 10,
  },
  {
    id: "reedwake",
    title: "Across the water",
    text: "Dock at Reedwake.",
    event: "visit:reedwake",
    amount: 1,
    coins: 20,
  },
  {
    id: "cinder",
    title: "Cinder on the horizon",
    text: "Dock at Cinder Shoal and bring the steward two iron ore.",
    event: "handin",
    amount: 1,
    coins: 20,
    handIn: { iron_ore: 2 },
  },
];
export const ORDERS = [
  { id: "timber", inputs: { timber: 8 } as Cost },
  { id: "stone", inputs: { stone: 8 } as Cost },
  { id: "planks", inputs: { planks: 6 } as Cost },
  { id: "rope", inputs: { rope: 3 } as Cost },
  { id: "food", inputs: { berry_greenberry: 6 } as Cost },
];
export const RESOURCE_PATCHES = (
  ["settlement", "reedwake", "cinder"] as const
).flatMap((region) => {
  const items =
    region === "settlement"
      ? [
          "timber",
          "stone",
          "fibre",
          "clay",
          "berry_greenberry",
          "berry_strawberry",
        ]
      : region === "reedwake"
        ? [
            "reeds",
            "resin",
            "fibre",
            "timber",
            "carrot_seed",
            "berry_greenberry",
          ]
        : ["iron_ore", "stone", "clay", "timber"];
  return items.map((item, i) => ({
    id: `${region}-${item}`,
    region,
    item,
    // The starter grove is a short walk from the steward, outside reserved plots.
    x: region === "settlement" ? [33, 33, 33, 33, 29, 29][i] : 113,
    z: region === "settlement" ? [52, 56, 72, 76, 54, 74][i] : 12 + i * 14,
  }));
}).concat(
  // Keep the original IDs/positions. Additional shared trees appear for existing
  // worlds through the catalog; reservations are created lazily on first use.
  // The central woodland strip stays outside every plot's maximum 16×16 bounds.
  [{ x: 29, z: 47 }, { x: 29, z: 58 }, { x: 29, z: 70 }, { x: 33, z: 82 }, { x: 29, z: 94 }]
    .map((point, i) => ({ id: `settlement-timber-${i + 2}`, region: "settlement" as const, item: "timber", ...point })),
);

export const DISCIPLINE_PERKS = [
  [
    "Level 2: +10% weapon damage, within the shared cap.",
    "Level 5: brace against a creature strike.",
    "Level 10: a pick gathers two stone or iron ore.",
  ],
  [
    "Level 2: one extra carrot per harvest.",
    "Level 5: gather plants in 2.4 seconds.",
    "Level 10: food restores two extra HP, capped at ten.",
  ],
  [
    "Level 2: one extra output from batch recipes.",
    "Level 5: brick walls and iron fittings.",
    "Level 10: one fewer material in recipe inputs of four or more.",
  ],
  [
    "Level 2: train companion abilities and pack cargo.",
    "Level 5: tame observed creatures with one feeding.",
    "Level 10: companion abilities recover in 30 seconds.",
  ],
  [
    "Level 2: survey a hidden cache in each new land region.",
    "Level 5: dock from four tiles away.",
    "Level 10: faster skiff travel.",
  ],
] as const;
