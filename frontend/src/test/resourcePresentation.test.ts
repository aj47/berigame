import { describe, expect, it } from 'vitest';
import { gatheringMotion, gatheringTool, resourceHover, resourcePresentation, resourceStatus } from '../frontier/resourcePresentation';

describe('server-timed resource presentation', () => {
  it('fills progress during the committed gathering duration', () => {
    const resource = {harvest:{by:'a',startedAt:1000,completesAt:4000,origin:{x:0,z:0},hp:30}};
    expect(resourcePresentation(resource,2500).progress).toBe(.5);
    expect(resourcePresentation(resource,4500).progress).toBe(1);
  });
  it('shows a fall, a stump, then a growing tree until the server regrowth deadline', () => {
    const resource = {felledAt:4000,regrowsAt:16000};
    expect(resourcePresentation(resource,4500)).toMatchObject({falling:true,showStump:true,treeScale:1});
    expect(resourcePresentation(resource,6000)).toMatchObject({falling:false,showStump:true,treeScale:0});
    expect(resourcePresentation(resource,14900).treeScale).toBe(.5);
    expect(resourcePresentation(resource,16000)).toMatchObject({regrowing:false,showStump:false,treeScale:1});
  });
  it('uses chopping for timber, a tool swing for rock and the existing reach for plants', () => {
    expect(gatheringMotion('timber')).toBe('chop');
    expect(gatheringMotion('iron_ore')).toBe('mine');
    expect(gatheringMotion('berry_strawberry')).toBe('pluck');
    expect(gatheringMotion('resin')).toBe('pluck');
  });
  it('uses the public tool reservation so other players see the correct hatchet or axe', () => {
    const harvest = {by:'a',startedAt:1000,completesAt:4000,origin:{x:0,z:0},hp:30};
    expect(gatheringTool({item:'timber',harvest})).toBe('hatchet');
    expect(gatheringTool({item:'timber',harvest:{...harvest,tool:'axe'}})).toBe('axe');
    expect(gatheringTool({item:'stone',harvest:{...harvest,tool:'pick'}})).toBe('mine');
    expect(gatheringTool({item:'fibre',harvest:{...harvest,tool:'hands'}})).toBeNull();
  });
  it('hovers like island trees: click for options, with timber yield and availability as detail', () => {
    expect(resourceHover({item:'timber'},1000)).toMatchObject({title:'Marked timber pine',action:'Click for chop options',detail:'Starter hatchet · 1 timber',click:'panel',tone:'ready'});
    expect(resourceHover({item:'timber'},1000,true).detail).toBe('Axe · 2 timber');
    expect(resourceHover({item:'timber',regrowsAt:12000},1000,true)).toMatchObject({detail:expect.stringContaining('try another tree'),tone:'muted'});
    expect(resourceHover({item:'berry_blueberry'},1000).action).toBe('Click for harvest options');
  });
  it('labels the dropdown action with the verb, who is gathering, or the regrowth countdown', () => {
    const harvest = {by:'me',startedAt:1000,completesAt:4000,origin:{x:0,z:0},hp:30};
    expect(resourceStatus({item:'timber'},1000,'me')).toMatchObject({label:'Chop timber pine',unavailable:false});
    expect(resourceStatus({item:'iron_ore'},1000,'me').label).toBe('Mine Iron ore');
    expect(resourceStatus({item:'fibre'},1000,'me').label).toBe('Gather Fibre');
    expect(resourceStatus({item:'timber',harvest},1000,'me')).toMatchObject({label:'You are chopping',unavailable:true});
    expect(resourceStatus({item:'timber',harvest},1000,'other','Robin').label).toBe('Robin is chopping');
    expect(resourceStatus({item:'timber',regrowsAt:12000},1500,'me')).toMatchObject({label:'Regrowing (11s)',unavailable:true});
  });
});
