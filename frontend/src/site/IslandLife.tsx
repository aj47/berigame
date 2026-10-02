import { wikiUrl } from './siteUrls';
import React, { useRef, useState } from 'react';
import { Arrow } from './SiteIcons';
import './islandLife.css';

const chapters = [
  {
    id: 'grow', label: 'Gather & grow', item: 'blueberry', image: 'gather',
    alt: 'A pink berry in the sunshine beside the Grove’s cottage and wooden bridge',
    caption: 'A little patience. A sweeter reward.', eyebrow: 'FOR THE QUIETLY CURIOUS',
    title: 'Good things', emphasis: 'start small.',
    description: 'A ripe berry. A patch of earth. A reason to come back. Find your own rhythm in the Grove, where every harvest helps your next adventure take root.',
    steps: [
      { title: 'Pick your first berries', detail: 'Find a ripe tree and start gathering.' },
      { title: 'Plant a little possibility', detail: 'Save a berry for your personal garden.' },
      { title: 'Come back to something good', detail: 'Crops grow while you’re away and wait until you’re ready.' },
    ],
    href: 'garden', link: 'Find your green fingers', note: 'YOUR GARDEN · YOUR PACE',
  },
  {
    id: 'explore', label: 'Craft & explore', item: 'stone_club', image: 'explore',
    alt: 'Adventurers and Pip crossing a wooden bridge over the turquoise island brook',
    caption: 'One discovery leads to the next.', eyebrow: 'FOR THE PATH LESS TRAVELLED',
    title: 'A useful find.', emphasis: 'A new way forward.',
    description: 'Beyond the brambles, driftwood and flint become something more. Make your first weapon, follow the shoreline, and see how far a little resourcefulness can take you.',
    steps: [
      { title: 'Earn your first Stick', detail: 'Four berry harvests open the route to the Coast.' },
      { title: 'Make a Stone Club', detail: 'Combine one driftwood with two flint shards.' },
      { title: 'Venture into the Boulders', detail: 'Carry your club and pack a few berries for the road.' },
    ],
    href: 'crafting', link: 'Discover what you can make', note: 'GATHER · MAKE · DISCOVER',
  },
  {
    id: 'together', label: 'Adventure together', item: 'goldberry', image: 'together',
    alt: 'Friends, Moss the gentle giant, and Pip celebrating around a berry feast in the Grove',
    caption: 'The best finds are the ones you share.', eyebrow: 'FOR THE STORIES YOU’LL SHARE',
    title: 'Small island.', emphasis: 'Good company.',
    description: 'Some berries are too big for a bag. Start an expedition, bring a friend, and turn a very unusual harvest into a market delivery or a feast in the woods.',
    steps: [
      { title: 'Meet at the gardener camp', detail: 'Start a giant berry expedition in the Grove.' },
      { title: 'Find a little helping hand', detail: 'Work with other players or recruit Moss to carry cargo.' },
      { title: 'Make it a day to remember', detail: 'Deliver to market or bring everyone to the feast clearing.' },
    ],
    href: 'expeditions', link: 'Plan a shared adventure', note: 'SOME THINGS ARE BETTER SHARED',
  },
];

export default function IslandLife() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % chapters.length;
    else if (event.key === 'ArrowLeft') next = (index + chapters.length - 1) % chapters.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = chapters.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return <section id="island" className="island-life site-section" aria-labelledby="journey-title">
    <div className="section-heading island-life-heading">
      <div><p className="site-kicker">A LITTLE WORLD. A LIFE OF YOUR OWN.</p><h2 id="journey-title">What’s your kind<br className="island-life-heading-break" /> of <em>adventure?</em></h2></div>
      <p>Take the scenic route. Grow something good.<br className="desktop-break" /> Find your people. There’s no single way to belong.</p>
    </div>
    <div className="island-life-tabs" role="tablist" aria-label="Discover island life">
      {chapters.map((chapter, index) => <button key={chapter.id} type="button" role="tab" id={`life-tab-${chapter.id}`} aria-controls={`life-panel-${chapter.id}`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} ref={element => { tabs.current[index] = element; }} onClick={() => setSelected(index)} onKeyDown={event => moveTab(event, index)}>
        <span className="life-tab-number" aria-hidden="true">0{index + 1}</span><span>{chapter.label}</span><Arrow diagonal />
      </button>)}
    </div>
    {chapters.map((chapter, index) => <div key={chapter.id} className="island-life-panel" role="tabpanel" id={`life-panel-${chapter.id}`} aria-labelledby={`life-tab-${chapter.id}`} hidden={selected !== index} tabIndex={0}>
      <figure className={`island-life-figure life-figure-${chapter.image}`}>
        <div className="island-life-photo"><img src={`/site/life-${chapter.image}.webp`} width="1440" height="810" alt={chapter.alt} loading="lazy" /><span className="life-photo-label">POSTCARDS FROM BRAMBLEWILD</span><span className="life-photo-chapter" aria-hidden="true">0{index + 1}<span> / 03</span></span><p className="life-photo-caption">{chapter.caption}</p></div>
        <figcaption><span>A GLIMPSE OF ISLAND LIFE</span><span>FROM THE BERIGAME FILM</span></figcaption>
        <span className="life-item-stamp" aria-hidden="true"><img src={`/items/${chapter.item}.png`} alt="" width="100" height="100" loading="lazy" /></span>
      </figure>
      <div className="island-life-copy">
        <p className="site-kicker">{chapter.eyebrow}</p>
        <h3>{chapter.title}<br /><em>{chapter.emphasis}</em></h3>
        <p className="life-description">{chapter.description}</p>
        <ol className="life-steps">{chapter.steps.map((step, stepIndex) => <li key={step.title}><span aria-hidden="true">0{stepIndex + 1}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol>
        <a className="site-text-link" href={wikiUrl(chapter.href)}>{chapter.link}<Arrow /></a>
      </div>
    </div>)}
    <div className="island-life-bottom" aria-hidden="true"><span className="life-bottom-flourish"><svg viewBox="0 0 24 24" fill="none"><path d="M12 22V11m0 5C5 16 3 11 3 5c7 0 9 4 9 11Zm0-4C12 5 16 2 22 2c0 7-4 10-10 10Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></span><span>{chapters[selected].note}</span><span>LET CURIOSITY LEAD THE WAY</span></div>
  </section>;
}
