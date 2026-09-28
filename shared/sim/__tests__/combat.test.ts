import { describe, expect, it } from 'vitest';
import { isSwingDue, retaliationSwingTick } from '../combat';
import { HOTBAR_SIZE, PUNCH_DAMAGE, STICK_DROP_CHANCE } from '../constants';
import { ITEM_DEFS, STICK_ITEM_ID, harvestFindsStick, inHotbar, isWeapon, swingDamage } from '../items';
import { emptySlots } from '../inventory';

describe('swing damage', () => {
  it('bare fists punch for PUNCH_DAMAGE', () => {
    expect(swingDamage('')).toBe(PUNCH_DAMAGE);
  });
  it('a wielded stick hits harder than a punch', () => {
    expect(swingDamage(STICK_ITEM_ID)).toBe(ITEM_DEFS[STICK_ITEM_ID].weaponDamage);
    expect(swingDamage(STICK_ITEM_ID)).toBeGreaterThan(PUNCH_DAMAGE);
  });
  it('anything that is not a weapon falls back to a punch', () => {
    expect(swingDamage('berry_blueberry')).toBe(PUNCH_DAMAGE);
    expect(swingDamage('no_such_item')).toBe(PUNCH_DAMAGE);
  });
  it('only the stick is a weapon, and it is not edible', () => {
    expect(isWeapon(STICK_ITEM_ID)).toBe(true);
    expect(isWeapon('berry_goldberry')).toBe(false);
    expect(isWeapon('')).toBe(false);
    expect(ITEM_DEFS[STICK_ITEM_ID].healthRestore).toBe(0);
    expect(ITEM_DEFS[STICK_ITEM_ID].maxStack).toBe(1);
  });
});

describe('hotbar', () => {
  it('covers exactly the first HOTBAR_SIZE slots', () => {
    const slots = emptySlots();
    slots[HOTBAR_SIZE - 1] = { itemId: STICK_ITEM_ID, quantity: 1 };
    expect(inHotbar(slots, STICK_ITEM_ID)).toBe(true);
    slots[HOTBAR_SIZE - 1] = null;
    slots[HOTBAR_SIZE] = { itemId: STICK_ITEM_ID, quantity: 1 };
    expect(inHotbar(slots, STICK_ITEM_ID)).toBe(false);
  });
});

describe('stick drop roll', () => {
  it('finds a stick for rolls below the drop chance only', () => {
    expect(harvestFindsStick(0)).toBe(true);
    expect(harvestFindsStick(STICK_DROP_CHANCE - 1e-9)).toBe(true);
    expect(harvestFindsStick(STICK_DROP_CHANCE)).toBe(false);
    expect(harvestFindsStick(0.999)).toBe(false);
  });
});

describe('rally timing', () => {
  it('retaliator swings 2 ticks after the opponent', () => {
    expect(retaliationSwingTick(10, 12)).toBe(14);
  });
  it('advances into the future when the opponent swing is stale', () => {
    expect(retaliationSwingTick(20, 12)).toBe(22);
    expect(retaliationSwingTick(22, 12)).toBe(26);
  });
  it('isSwingDue', () => {
    expect(isSwingDue(5, 5)).toBe(true);
    expect(isSwingDue(4, 5)).toBe(false);
  });
});
