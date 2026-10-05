/** Shared with authoritative validation. Saved indices require append-only catalogs. */
export const HAIR_STYLES = [
  { id: 'tousled', name: 'Tousled' },
  { id: 'cropped', name: 'Cropped' },
  { id: 'topknot', name: 'Topknot' },
  { id: 'bald', name: 'Shaved' },
  { id: 'swept', name: 'Side swept' },
  { id: 'bob', name: 'Bob' },
  { id: 'ponytail', name: 'Ponytail' },
  { id: 'braids', name: 'Twin braids' },
  { id: 'mohawk', name: 'Mohawk' },
  { id: 'long-straight', name: 'Long straight' },
  { id: 'long-waves', name: 'Long waves' },
  { id: 'curly-bob', name: 'Curly bob' },
  { id: 'natural-curls', name: 'Natural curls' },
  { id: 'high-ponytail', name: 'High ponytail' },
  { id: 'twin-ponytails', name: 'Twin ponytails' },
  { id: 'double-buns', name: 'Double buns' },
  { id: 'side-braid', name: 'Side braid' },
  { id: 'crown-braid', name: 'Crown braid' },
  { id: 'long-locs', name: 'Long locs' },
] as const;
export const SKIN_TONES = [
  { name: 'Warm tan', color: '#DFA76E' },
  { name: 'Fair', color: '#F1CBAA' },
  { name: 'Golden', color: '#C58B55' },
  { name: 'Olive', color: '#B68A66' },
  { name: 'Brown', color: '#94613E' },
  { name: 'Deep brown', color: '#64412E' },
  { name: 'Porcelain', color: '#F6DCCE' },
  { name: 'Rose', color: '#D6A08B' },
  { name: 'Umber', color: '#784E3E' },
  { name: 'Ebony', color: '#493329' },
] as const;
export const HAIR_COLORS = [
  { name: 'Chestnut', color: '#483326' },
  { name: 'Black', color: '#27242A' },
  { name: 'Copper', color: '#8C4930' },
  { name: 'Silver', color: '#A9A7A0' },
  { name: 'Honey', color: '#BE944F' },
  { name: 'Cream', color: '#E8D6A7' },
  { name: 'Auburn', color: '#643528' },
  { name: 'Snow', color: '#E8E4E0' },
  { name: 'Rose', color: '#B16A8A' },
  { name: 'Lavender', color: '#8C7DBA' },
  { name: 'Ocean', color: '#456C95' },
  { name: 'Moss', color: '#658573' },
  { name: 'Strawberry blonde', color: '#CB9871' },
  { name: 'Chocolate', color: '#634334' },
  { name: 'Blush', color: '#DEA4AE' },
  { name: 'Mint', color: '#94BBA4' },
] as const;
export const ROBE_COLORS = [
  { name: 'Blue', color: '#42699C' },
  { name: 'Forest', color: '#4F7358' },
  { name: 'Russet', color: '#99554B' },
  { name: 'Plum', color: '#78567E' },
  { name: 'Oat', color: '#A99D7E' },
  { name: 'Teal', color: '#347D7C' },
  { name: 'Marigold', color: '#C39844' },
  { name: 'Rose', color: '#B77482' },
  { name: 'Cloud', color: '#D5D4C6' },
  { name: 'Midnight', color: '#303B54' },
  { name: 'Clay', color: '#BA7954' },
  { name: 'Sage', color: '#91A482' },
] as const;
export const WRAP_COLORS = [
  { name: 'Linen', color: '#E3D4B2' },
  { name: 'Flax', color: '#BDA578' },
  { name: 'Slate', color: '#82939F' },
  { name: 'Ivory', color: '#F2EAD7' },
  { name: 'Charcoal', color: '#41424B' },
  { name: 'Berry', color: '#9D5668' },
  { name: 'Seafoam', color: '#75AAA0' },
  { name: 'Gold', color: '#C6A251' },
  { name: 'Lilac', color: '#B6A1C8' },
  { name: 'Rust', color: '#AF6748' },
] as const;
export const BODY_TYPES = ['Classic', 'Slender', 'Broad', 'Compact'].map(name => ({ name }));
export const FACE_SHAPES = ['Classic', 'Round', 'Long', 'Wide'].map(name => ({ name }));
export const FACIAL_HAIR = ['None', 'Moustache', 'Goatee', 'Full beard'].map(name => ({ name }));
export const OUTFIT_STYLES = ['Tunic', 'Trail scarf', 'Shoulder mantle', 'Explorer vest'].map(name => ({ name }));
export const ACCESSORIES = ['None', 'Round glasses', 'Hoop earrings', 'Headband', 'Eye patch', 'Nose ring', 'Ribbon bow', 'Flower clip', 'Flower crown', 'Drop earrings'].map(name => ({ name }));
export const EYE_COLORS = [
  { name: 'Dark brown', color: '#221B18' }, { name: 'Hazel', color: '#6D5631' },
  { name: 'Blue', color: '#487999' }, { name: 'Green', color: '#577C4F' },
  { name: 'Grey', color: '#81919A' }, { name: 'Amber', color: '#B47F31' },
  { name: 'Violet', color: '#8271A7' }, { name: 'Ice', color: '#A5CDCC' },
];
export const TROUSER_COLORS = [
  { name: 'Slate', color: '#5E6479' }, { name: 'Ink', color: '#323745' },
  { name: 'Sand', color: '#AD9876' }, { name: 'Moss', color: '#566951' },
  { name: 'Umber', color: '#755A4A' }, { name: 'Wine', color: '#74505F' },
  { name: 'Denim', color: '#506F8A' }, { name: 'Cream', color: '#C8BEA3' },
];
export const BOOT_COLORS = [
  { name: 'Leather', color: '#674731' }, { name: 'Black', color: '#303039' },
  { name: 'Tan', color: '#A47D51' }, { name: 'Oxblood', color: '#713D3C' },
  { name: 'Grey', color: '#777977' }, { name: 'Cream', color: '#BCAE90' },
];
export const ACCESSORY_COLORS = WRAP_COLORS;
/** The original five fields remain valid for older agent clients. */
export interface Appearance {
  hairStyle: number; skinTone: number; hairColor: number; robeColor: number; wrapColor: number;
  bodyType?: number; faceShape?: number; eyeColor?: number; facialHair?: number;
  outfitStyle?: number; trouserColor?: number; bootColor?: number; accessory?: number; accessoryColor?: number;
}
export type CharacterAppearance = Required<Appearance>;
export const DEFAULT_APPEARANCE: Readonly<CharacterAppearance> = {
  hairStyle: 0, skinTone: 0, hairColor: 0, robeColor: 0, wrapColor: 0,
  bodyType: 0, faceShape: 0, eyeColor: 0, facialHair: 0, outfitStyle: 0,
  trouserColor: 0, bootColor: 0, accessory: 0, accessoryColor: 0,
};
export const APPEARANCE_LIMITS = {
  hairStyle: HAIR_STYLES.length, skinTone: SKIN_TONES.length, hairColor: HAIR_COLORS.length,
  robeColor: ROBE_COLORS.length, wrapColor: WRAP_COLORS.length, bodyType: BODY_TYPES.length,
  faceShape: FACE_SHAPES.length, eyeColor: EYE_COLORS.length, facialHair: FACIAL_HAIR.length,
  outfitStyle: OUTFIT_STYLES.length, trouserColor: TROUSER_COLORS.length, bootColor: BOOT_COLORS.length,
  accessory: ACCESSORIES.length, accessoryColor: ACCESSORY_COLORS.length,
} as const;
export const APPEARANCE_KEYS = Object.keys(APPEARANCE_LIMITS) as (keyof CharacterAppearance)[];
export function normalizeAppearance(value?: Partial<Appearance> | null): CharacterAppearance {
  return Object.fromEntries(APPEARANCE_KEYS.map(key => [key, value?.[key] ?? DEFAULT_APPEARANCE[key]])) as CharacterAppearance;
}
export function validAppearance(value: Appearance): boolean {
  const complete = normalizeAppearance(value);
  if (['hairStyle','skinTone','hairColor','robeColor','wrapColor'].some(key => !Number.isInteger(value[key as keyof Appearance]))) return false;
  return APPEARANCE_KEYS.every(key => Number.isInteger(complete[key]) && complete[key] >= 0 && complete[key] < APPEARANCE_LIMITS[key]);
}
export const CHARACTER_PRESETS = [
  { name: 'Wayfarer', description: 'Blue skies, open roads', choices: {} },
  { name: 'Woodland', description: 'At home among the trees', choices: { hairStyle: 7, hairColor: 4, robeColor: 1, wrapColor: 1, skinTone: 4, eyeColor: 3, outfitStyle: 2, trouserColor: 3 } },
  { name: 'Sunseeker', description: 'A little warmth everywhere', choices: { hairStyle: 5, hairColor: 2, robeColor: 6, skinTone: 5, wrapColor: 3, bodyType: 1, accessory: 2, accessoryColor: 7, trouserColor: 2 } },
  { name: 'Tidewalker', description: 'Follow the sea breeze', choices: { hairStyle: 6, hairColor: 7, robeColor: 5, skinTone: 3, eyeColor: 2, outfitStyle: 1, wrapColor: 6, accessory: 3, accessoryColor: 6, bootColor: 4 } },
  { name: 'Stargazer', description: 'A curious soul after dark', choices: { hairStyle: 4, hairColor: 9, robeColor: 3, skinTone: 6, faceShape: 1, eyeColor: 6, accessory: 1, accessoryColor: 7, trouserColor: 1 } },
  { name: 'Pathfinder', description: 'Ready for the next discovery', choices: { hairStyle: 3, skinTone: 8, robeColor: 10, wrapColor: 4, bodyType: 2, facialHair: 3, outfitStyle: 3, accessory: 4, accessoryColor: 4, trouserColor: 4, bootColor: 1 } },
  { name: 'Blossom', description: 'Waves and a flower in your hair', choices: { hairStyle: 10, hairColor: 12, skinTone: 1, robeColor: 7, wrapColor: 3, bodyType: 1, eyeColor: 3, accessory: 7, accessoryColor: 8, trouserColor: 7, bootColor: 5 } },
  { name: 'Dune dancer', description: 'Full curls and golden details', choices: { hairStyle: 12, hairColor: 1, skinTone: 9, robeColor: 6, wrapColor: 7, eyeColor: 5, accessory: 9, accessoryColor: 7, trouserColor: 4, bootColor: 2 } },
  { name: 'Moonbeam', description: 'A braided crown under the stars', choices: { hairStyle: 17, hairColor: 9, skinTone: 3, robeColor: 3, wrapColor: 8, faceShape: 1, eyeColor: 6, outfitStyle: 2, accessory: 9, accessoryColor: 3, trouserColor: 1, bootColor: 4 } },
  { name: 'Wildflower', description: 'Long locs, fresh-picked blooms', choices: { hairStyle: 18, hairColor: 13, skinTone: 5, robeColor: 11, wrapColor: 6, eyeColor: 1, accessory: 8, accessoryColor: 5, trouserColor: 3, bootColor: 0 } },
] as const;
/** Existing named players keep their setup; untouched newcomers see the creator. */
export function needsCharacterSetup(name: string, appearance?: { setupComplete?: boolean }): boolean {
  return !appearance?.setupComplete && /^Player-[0-9a-f]{4}$/i.test(name);
}
