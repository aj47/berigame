import fs from 'fs';
import path from 'path';
import { ITEM_DEFS, SEASON_ITEMS } from '@sim';

const PUBLIC = path.resolve(__dirname, '../../public');
const iconFile = (icon: string) => path.join(PUBLIC, icon.replace(/^\//, ''));

/** PNG width and height from the IHDR chunk. */
function pngSize(file: string): [number, number] {
  const head = fs.readFileSync(file).subarray(0, 24);
  expect(head.subarray(1, 4).toString('latin1'), file).toBe('PNG');
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

describe('item icons', () => {
  it('has an icon file under public/ for every item', () => {
    const missing = Object.values(ITEM_DEFS).filter((def) => !fs.existsSync(iconFile(def.icon))).map((def) => `${def.id} -> ${def.icon}`);
    expect(missing).toEqual([]);
  });

  it('draws every Long Season item as a 128px PNG like the other icons', () => {
    for (const item of SEASON_ITEMS) {
      const icon = ITEM_DEFS[item.id].icon;
      expect(icon).toBe(`/items/season/${item.id}.png`);
      expect(pngSize(iconFile(icon)), item.id).toEqual([128, 128]);
    }
  });
});
