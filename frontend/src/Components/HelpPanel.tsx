import React from 'react';
import { agentUrl, wikiUrl } from '../site/siteUrls';
import { getItemDef, PUNCH_DAMAGE, STICK_ITEM_ID } from '@sim';
import './menuGuide.css';

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  const stick = getItemDef(STICK_ITEM_ID);
  return <section className="game-panel help-panel" aria-label="How to play">
    <header className="panel-heading">
      <h2>How to play</h2>
      <button className="close-button" onClick={onClose} aria-label="Close help">×</button>
    </header>
    <ol className="help-trail">
      <li><img src="/items/greenberry.png" alt="" /><div><strong>Pick a berry</strong><span>Tap a tree → Harvest. Eat berries to heal.</span></div></li>
      <li><img src={stick?.icon} alt="" /><div><strong>Find your first stick</strong><span>Harvest 4 times, then drag it from your bag to a quick slot.</span></div></li>
      <li><img src="/items/stone_club.png" alt="" /><div><strong>Explore the Coast</strong><span>Carry a stick through the brambles. Gather supplies and craft a club.</span></div></li>
    </ol>
    <div className="help-controls" aria-label="World controls">
      <span><strong>Move</strong>Left click or tap the ground</span><span><strong>Look</strong>Right drag · touch drag</span>
      <span><strong>More actions</strong>Press and hold</span><span><strong>Cancel action</strong>Tap Stop or press Esc</span>
    </div>
    <details className="menu-guide-details"><summary>Gathering & crafting</summary>
      <ul><li>Tap your goal for the next step. At a busy or regrowing tree, you wait for the next harvest.</li>
        <li>Your first stick arrives at Foraging level 2. Later berry harvests have a 25% chance to find another.</li>
        <li>On the Coast, collect driftwood from piles and flint from tide rocks. A Stone Club costs 1 driftwood + 2 flint and deals 8 damage.</li>
        <li>Island skills and adventure techniques unlock recipes, keepsakes and faster harvests without increasing PvP damage or health. Meadows disciplines have separate perks, including Might’s damage and health bonuses.</li>
        <li>In the Meadows, chop marked timber trees with your starter hatchet. Craft an Axe to collect two Timber per cut. Try another tree while a stump regrows.</li></ul>
    </details>
    <details className="menu-guide-details"><summary>Bag & quick slots</summary>
      <ul><li>Drag to move or swap items. On touch, hold then drag. You can also select an item and choose Move.</li>
        <li>Put food or weapons in the three quick slots. Tap one to eat, wield or put away.</li>
        <li>A stick lets you leave the Grove; you can always return without one. Dying drops your bag, including your stick.</li></ul>
    </details>
    <details className="menu-guide-details"><summary>Gardens</summary>
      <p>Plant a berry in a soil plot north-west of the safe ring. Greenberries grow in 2 hours; goldberries take 8. They grow while you’re away and wait when ripe.</p>
    </details>
    <details className="menu-guide-details"><summary>Fighting & staying safe</summary>
      <p>Select a player → Attack. You approach and swing automatically. A punch deals {PUNCH_DAMAGE} damage; a wielded stick deals {stick?.weaponDamage}.</p>
      <p>The sandy centre ring is safe. You also get brief protection after respawning. Newcomer protection ends when you find a stick, attack, or reach 3 minutes.</p>
    </details>
    <details className="menu-guide-details"><summary>Keyboard & camera</summary>
      <dl className="help-keys">{[['1 / 2 / 3', 'Use quick slot'], ['I', 'Bag'], ['K', 'Skills'], ['C', 'Craft'], ['Enter', 'Chat'], ['O', 'Settings'], ['Esc', 'Close / stop']].map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}</dl>
      <p>Drag with the right mouse button to rotate the camera. On touch screens, drag to rotate. Hold the ground to keep walking. Scroll or pinch to zoom.</p>
      <button className="reset-view-button" onClick={() => window.dispatchEvent(new Event('berigame-camera-reset'))}>Reset view</button>
    </details>
    <a className="agent-help-link" href={wikiUrl()} target="_blank" rel="noreferrer">BeriGame wiki ↗</a>
    <br />
    <a className="agent-help-link" href={agentUrl()} target="_blank" rel="noreferrer">Play with an agent ↗</a>
  </section>;
}
