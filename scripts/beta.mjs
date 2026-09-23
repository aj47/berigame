import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = 'frontend/cloudflare/wrangler.jsonc';
const [command, ...args] = process.argv.slice(2);
function run(executable, argv, env = {}) {
  const result = spawnSync(executable, argv, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function build() {
  run('npm', ['run', 'build', '--prefix', 'frontend'], {
    VITE_SPACETIME_URI: 'wss://maincloud.spacetimedb.com', VITE_SPACETIME_DB: 'berigame-beta', VITE_INVITE_REQUIRED: 'true',
  });
}
try {
  if (command === 'build') build();
  else if (command === 'types') run('wrangler', ['types', '--config', config, 'frontend/cloudflare/worker-configuration.d.ts']);
  else if (command === 'deploy') { build(); run('wrangler', ['deploy', '--config', config]); }
  else if (['invite', 'revoke'].includes(command)) {
    const file = process.env.BERIGAME_BETA_SECRETS ?? resolve(root, '.spacetime-data/deploy-beta/cloudflare-secrets.json');
    const { ADMIN_TOKEN } = JSON.parse(readFileSync(file, 'utf8'));
    const origin = process.env.BERIGAME_BETA_ORIGIN ?? 'https://beta.berigame.com';
    if (new URL(origin).protocol !== 'https:' && !origin.startsWith('http://127.0.0.1:')) throw new Error('Use HTTPS for the beta API.');
    let path, body;
    if (command === 'invite') {
      if (args.some(arg => !['--human', '--combat', '--chat'].includes(arg))) throw new Error('Use beta:invite [--human] [--combat] [--chat].');
      path = '/api/admin/invites';
      body = { kind: args.includes('--human') ? 'human' : 'agent', combat: Number(args.includes('--combat')), chat: Number(args.includes('--chat')) };
    } else {
      if (args.length !== 1 || !/^[0-9a-f-]{36}$/.test(args[0])) throw new Error('Use beta:revoke SESSION_ID.');
      path = '/api/admin/revoke'; body = { sessionId: args[0] };
    }
    const response = await fetch(new URL(path, origin), { method: 'POST', headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status === 204) console.log('Player access revoked.');
    else {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status}).`);
      console.log(data.code);
      console.log(`${data.kind} invite; single use; expires ${data.expiresAt}. Share privately, separately from the URL.`);
    }
  } else throw new Error('Use build, types, deploy, invite, or revoke.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
