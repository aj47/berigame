/** Cosmetic choices are shared by the editor and authoritative validation. */
export const HAIR_STYLES = [
  { id: 'tousled', name: 'Tousled' },
  { id: 'cropped', name: 'Cropped' },
  { id: 'topknot', name: 'Topknot' },
] as const;
export const SKIN_TONES = [
  { name: 'Warm tan', color: '#DFA76E' },
  { name: 'Fair', color: '#F1CBAA' },
  { name: 'Golden', color: '#C58B55' },
  { name: 'Olive', color: '#B68A66' },
  { name: 'Brown', color: '#94613E' },
  { name: 'Deep brown', color: '#64412E' },
] as const;
export const HAIR_COLORS = [
  { name: 'Chestnut', color: '#483326' },
  { name: 'Black', color: '#27242A' },
  { name: 'Copper', color: '#8C4930' },
  { name: 'Silver', color: '#A9A7A0' },
] as const;
export const ROBE_COLORS = [
  { name: 'Blue', color: '#42699C' },
  { name: 'Forest', color: '#4F7358' },
  { name: 'Russet', color: '#99554B' },
  { name: 'Plum', color: '#78567E' },
  { name: 'Oat', color: '#A99D7E' },
] as const;
export const WRAP_COLORS = [
  { name: 'Linen', color: '#E3D4B2' },
  { name: 'Flax', color: '#BDA578' },
  { name: 'Slate', color: '#82939F' },
] as const;
export interface Appearance {
  hairStyle: number;
  skinTone: number;
  hairColor: number;
  robeColor: number;
  wrapColor: number;
}
export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  hairStyle: 0, skinTone: 0, hairColor: 0, robeColor: 0, wrapColor: 0,
};
export const APPEARANCE_LIMITS = {
  hairStyle: HAIR_STYLES.length, skinTone: SKIN_TONES.length,
  hairColor: HAIR_COLORS.length, robeColor: ROBE_COLORS.length, wrapColor: WRAP_COLORS.length,
} as const;
export function validAppearance(value: Appearance): boolean {
  return (Object.keys(APPEARANCE_LIMITS) as (keyof Appearance)[]).every((key) =>
    Number.isInteger(value[key]) && value[key] >= 0 && value[key] < APPEARANCE_LIMITS[key]);
}
