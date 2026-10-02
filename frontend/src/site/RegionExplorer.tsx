import { wikiUrl } from './siteUrls';
import React, { useState } from 'react';
import IslandMap from './IslandMap';
import { Arrow } from './SiteIcons';

type Region = 'grove' | 'coast' | 'boulders';
const regions: Record<Region, { title: string; caption: string; description: string; access: string; finds: string; image: string; }> = {
  grove: { title: 'The Grove', caption: 'WHERE EVERY STORY BEGINS', description: 'Follow the brook past the old mill. Pick your first berries, plant a little garden, and meet your travelling companions at camp. There’s a whole world inside these brambles.', access: 'Come as you are', finds: 'Berries, gardens & expeditions', image: 'blueberry' },
  coast: { title: 'The Coast', caption: 'A LITTLE FURTHER FROM HOME', description: 'Take a sturdy stick through the brambles and follow the shoreline. Between quiet coves and weathered ruins, driftwood and flint become the tools for your next adventure.', access: 'Carry a Stick', finds: 'Driftwood & Flint Shards', image: 'flint' },
  boulders: { title: 'The Boulders', caption: 'SOMETHING BIGGER IS WAITING', description: 'Beyond the south-east crossing, the island turns wild. A Stone Club opens the route to obsidian outcrops and the sleeping raid Giant. Pack some berries. Bring a friend.', access: 'Carry a Stone Club', finds: 'Obsidian & scheduled Giant raids', image: 'obsidian' },
};

export default function RegionExplorer() {
  const [selected, setSelected] = useState<Region>('grove');
  const region = regions[selected];
  return <section id="explore" className="landing-explorer site-section" aria-labelledby="explorer-title">
    <div className="explorer-heading"><div><p className="site-kicker">THE BRAMBLEWILD ATLAS</p><h2 id="explorer-title">Wonder what’s<br /><em>over there?</em></h2></div><p>Three regions. A few useful discoveries.<br />A little further each time.</p></div>
    <div className="explorer-layout">
      <div className="explorer-map"><IslandMap selected={selected} onSelect={setSelected} /><p className="explorer-map-caption"><span>BRAMBLEWILD · THE FIRST ISLAND</span><span>Select a place to explore</span></p></div>
      <div className="explorer-guide">
        <div className="region-selector" role="group" aria-label="Choose a region">{(Object.keys(regions) as Region[]).map((key, index) => <button key={key} type="button" aria-pressed={selected === key} onClick={() => setSelected(key)}><span>0{index + 1}</span>{regions[key].title}</button>)}</div>
        <div className="region-details" aria-live="polite" aria-atomic="true"><div className="region-overline"><p className="site-kicker">{region.caption}</p><img src={`/items/${region.image}.png`} alt="" loading="lazy" /></div><h3>{region.title}</h3><p className="region-description">{region.description}</p><dl><div><dt>THE WAY IN</dt><dd>{region.access}</dd></div><div><dt>WORTH THE TRIP</dt><dd>{region.finds}</dd></div></dl><a href={wikiUrl(selected)} className="site-text-link">Read the {region.title.replace('The ', '')} guide <Arrow /></a></div>
      </div>
    </div>
  </section>;
}
