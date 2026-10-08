import { TERRAIN_MAP } from '../../shared/sim';

/** Monochrome 20x20 berry for ChatGPT's sidebar (currentColor, 1.33px strokes). */
export const MCP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="12.5" r="3.5"/><circle cx="13" cy="12.5" r="3.5"/><path d="M10 9V5.5c0-1.5 1-2.5 2.5-3"/><path d="M10 6c-1.6-1.4-3.6-1.6-5-.8 1.2 1.6 3.2 2 5 .8z"/></svg>';

/**
 * The MCP App: a live map around your character with its status, polling the app-only live_view_state tool.
 * Opened from the sidebar without a character it is a launcher that asks the chat to join. Self-contained (the
 * host's iframe CSP blocks outside requests): the island rows are inlined and it speaks the MCP Apps
 * postMessage protocol directly.
 */
export const MCP_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BeriGame</title>
<style>
:root{--bg:#f4f1e8;--panel:#fffdf7;--ink:#24312a;--muted:#5d6b62;--line:#d9d2c0;--accent:#2f7a4f;--water:#7fb6c9;--land:#b9d29a;--hedge:#5c7f3e;--bridge:#b08a5a;--floor:#6e6a86}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17201b;--panel:#1f2a24;--ink:#e9efe7;--muted:#a8b5ab;--line:#33433a;--accent:#7cc79a;--water:#2c5868;--land:#42603a;--hedge:#2d4a24;--bridge:#7a5d3a;--floor:#45425a}}
:root[data-theme=dark]{--bg:#17201b;--panel:#1f2a24;--ink:#e9efe7;--muted:#a8b5ab;--line:#33433a;--accent:#7cc79a;--water:#2c5868;--land:#42603a;--hedge:#2d4a24;--bridge:#7a5d3a;--floor:#45425a}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;padding:12px;max-width:900px;margin:0 auto}
@media (max-width:600px){main{grid-template-columns:1fr}}
canvas{width:100%;aspect-ratio:1;border-radius:10px;border:1px solid var(--line);background:var(--water);display:block;image-rendering:pixelated}
aside{display:flex;flex-direction:column;gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px}
h1{font-size:16px;margin:0 0 2px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 6px}
.muted{color:var(--muted)}.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:6px}.bar>i{display:block;height:100%;background:#d9534f}
ul{margin:0;padding-left:18px}li{margin:1px 0}
button{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:7px 10px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.launcher{max-width:440px;margin:40px auto;padding:0 16px;text-align:center}.launcher p{color:var(--muted)}
.row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
[hidden]{display:none!important}
</style></head>
<body>
<section class="launcher" id="launcher">
  <h1>BeriGame</h1>
  <p>A cosy multiplayer island. Let ChatGPT play a character: it gathers berries, crafts, trades and joins boss fights while you watch the map here.</p>
  <div class="row"><button class="primary" id="start">Start playing</button><button id="site">Open berigame.com</button></div>
  <p id="status" class="muted"></p>
</section>
<main id="game" hidden>
  <canvas id="map" width="492" height="492" aria-label="Map around your character"></canvas>
  <aside>
    <div class="card"><h1 id="name">&hellip;</h1><div class="muted" id="where"></div><div class="bar"><i id="hp"></i></div><div class="muted" id="hptext"></div></div>
    <div class="card"><h2>Goal</h2><div id="goal" class="muted">&hellip;</div></div>
    <div class="card"><h2>Bag</h2><ul id="bag"></ul></div>
    <div class="card"><h2>Chat</h2><ul id="chat" class="muted"></ul></div>
    <button id="next">Take the next step</button>
  </aside>
</main>
<script>
const ROWS = ${JSON.stringify(TERRAIN_MAP.rows)};
const VIEW = 41, POLL_MS = 1500, HIDDEN_POLL_MS = 10000;
let nextId = 1, key = null, timer = null;
const pending = new Map();
const $ = id => document.getElementById(id);
function request(method, params) {
  const id = nextId++;
  parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const notify = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
const say = text => request('ui/message', { role: 'user', content: { type: 'text', text } }).catch(() => { $('status').textContent = 'Ask the chat to play BeriGame to start.'; });
function theme(ctx) { if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme; }
function onResult(result) {
  const data = result && result.structuredContent;
  const k = result && result._meta && result._meta.player_key;
  if (k) key = k;
  if (data && data.view) { show(data.view); poll(); }
  else if (data && data.launcher) { $('launcher').hidden = false; $('game').hidden = true; }
}
addEventListener('message', event => {
  if (event.source !== parent) return;
  const m = event.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.id !== undefined && !m.method) {
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'ui/notifications/tool-input') { const a = m.params && m.params.arguments; if (a && a.player_key) key = a.player_key; }
  else if (m.method === 'ui/notifications/tool-result') onResult(m.params);
  else if (m.method === 'ui/notifications/host-context-changed') theme(m.params);
  else if (m.method === 'ui/resource-teardown') { clearTimeout(timer); parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*'); }
  else if (m.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported' } }, '*');
});
function poll() {
  clearTimeout(timer);
  if (!key) return;
  // Hidden views refresh slowly instead of stopping, in case a host reports visibility differently.
  timer = setTimeout(async () => {
    try { const r = await request('tools/call', { name: 'live_view_state', arguments: { player_key: key } }); if (r && r.structuredContent && r.structuredContent.view) show(r.structuredContent.view); } catch {}
    poll();
  }, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
}
function show(v) {
  $('launcher').hidden = true; $('game').hidden = false;
  const you = v.you || {};
  $('name').textContent = you.name || 'Your character';
  $('where').textContent = (you.area || v.region || '') + (you.tile ? ' \\u00b7 (' + you.tile.x + ', ' + you.tile.z + ')' : '') + (you.action && you.action.text ? ' \\u00b7 ' + you.action.text : '');
  const hp = Math.max(0, Math.min(1, (you.health || 0) / Math.max(1, you.maxHealth || 1)));
  $('hp').style.width = Math.round(hp * 100) + '%';
  $('hptext').textContent = you.alive === false ? 'Knocked out' : (you.health + ' / ' + you.maxHealth + ' HP');
  $('goal').textContent = v.goal || 'Free play';
  fill($('bag'), (v.inventory || []).map(i => i.quantity + ' x ' + i.itemId.replace(/_/g, ' ') + (i.wielded ? ' (wielded)' : '')), 'Empty');
  fill($('chat'), (v.chat || []).map(c => c.from + ': ' + c.text), 'Quiet');
  draw(v);
}
function fill(list, lines, empty) {
  list.replaceChildren(...(lines.length ? lines : [empty]).map(line => { const li = document.createElement('li'); li.textContent = line; return li; }));
}
function draw(v) {
  const c = $('map'), g = c.getContext('2d'), css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(name).trim();
  const me = (v.you && v.you.tile) || { x: 0, z: 0 }, half = (VIEW - 1) / 2, s = c.width / VIEW;
  const home = v.region === 'bramblewild';
  const tiles = { '~': color('--water'), '.': color('--land'), '#': color('--hedge'), '=': color('--bridge'), '%': color('--floor') };
  for (let dz = 0; dz < VIEW; dz++) for (let dx = 0; dx < VIEW; dx++) {
    const x = me.x - half + dx, z = me.z - half + dz;
    const t = home && ROWS[z] ? ROWS[z][x] : (home ? '~' : '.');
    g.fillStyle = tiles[t] || tiles['~']; g.fillRect(dx * s, dz * s, s + 0.5, s + 0.5);
  }
  const at = (t, r, fill, ring) => {
    const px = (t.x - me.x + half + 0.5) * s, pz = (t.z - me.z + half + 0.5) * s;
    if (px < 0 || pz < 0 || px > c.width || pz > c.height) return;
    g.beginPath(); g.arc(px, pz, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    if (ring) { g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); }
  };
  for (const n of v.nodes || []) at(n.tile, s * 0.38, n.kind === 'berry' ? (n.ready ? '#c0392b' : '#7d5a5a') : n.kind === 'driftwood' ? '#8b5a2b' : '#7f8c8d');
  for (const i of v.items || []) at(i.tile, s * 0.22, '#f1c40f');
  if (v.giant) at(v.giant.tile, s * 1.4, '#6c5b7b', '#3e3150');
  for (const p of v.players || []) at(p.tile, s * 0.42, p.hostile ? '#e74c3c' : '#3b6fd8', '#ffffff');
  at(me, s * 0.5, '#ffffff', '#111111');
}
$('start').onclick = () => say('Join BeriGame, show me the live view, and start playing toward the first goal.');
$('site').onclick = () => request('ui/open-link', { url: 'https://berigame.com' }).catch(() => {});
$('next').onclick = () => say('Look at my BeriGame character and take the next step toward the goal.');
document.addEventListener('visibilitychange', () => { if (!document.hidden && key) poll(); });
(async () => {
  try {
    const init = await request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'berigame-live-view', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } });
    theme(init && init.hostContext);
  } catch {}
  notify('ui/notifications/initialized', {});
})();
</script></body></html>`;
