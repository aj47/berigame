import { describe, expect, it } from 'vitest';
import { ACCESSORIES, HAIR_STYLES, APPEARANCE_KEYS, APPEARANCE_LIMITS, CHARACTER_PRESETS, DEFAULT_APPEARANCE, normalizeAppearance, needsCharacterSetup, validAppearance } from '../appearance';

describe('character catalog compatibility',()=>{
  it('keeps saved hairstyle and accessory indices stable when adding choices', () => {
    expect(HAIR_STYLES.slice(0, 9).map(style => style.id)).toEqual(['tousled','cropped','topknot','bald','swept','bob','ponytail','braids','mohawk']);
    expect(ACCESSORIES.slice(0, 6).map(option => option.name)).toEqual(['None','Round glasses','Hoop earrings','Headband','Eye patch','Nose ring']);
  });
  it('accepts legacy five-field choices and preserves the original indices',()=>{
    const old={hairStyle:2,skinTone:5,hairColor:3,robeColor:4,wrapColor:2};
    expect(validAppearance(old)).toBe(true);expect(normalizeAppearance(old)).toEqual({...DEFAULT_APPEARANCE,...old});
    expect(validAppearance({} as any)).toBe(false);
  });
  it('normalizes table rows without carrying identity or completion metadata',()=>{
    const row={...DEFAULT_APPEARANCE,identity:{__identity__:1n},setupComplete:true};
    expect(()=>JSON.stringify(normalizeAppearance(row))).not.toThrow();expect(normalizeAppearance(row)).toEqual(DEFAULT_APPEARANCE);
  });
  it('every preset uses available choices',()=>{for(const preset of CHARACTER_PRESETS)expect(validAppearance(normalizeAppearance(preset.choices))).toBe(true);});
  it.each(APPEARANCE_KEYS)('rejects invalid %s',key=>{for(const value of [-1,NaN,1.5,APPEARANCE_LIMITS[key]])expect(validAppearance({...DEFAULT_APPEARANCE,[key]:value})).toBe(false);});
  it('newcomers get setup while completed or previously named players keep their character',()=>{
    expect(needsCharacterSetup('Player-abcd')).toBe(true);
    expect(needsCharacterSetup('Player-abcd',{setupComplete:true})).toBe(false);
    expect(needsCharacterSetup('Fern',{setupComplete:false})).toBe(false);
    expect(needsCharacterSetup('Player Fern',{setupComplete:false})).toBe(false);
  });
});
