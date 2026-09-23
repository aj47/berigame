import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Identity } from 'spacetimedb';
import { connect, deadline, mintIdentity } from './game';
import { InviteStore } from './security';
import { readCredential, settings } from './settings';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const config = settings();
  if (command === 'setup') {
    if (args.length) throw new Error('Usage: agent:setup');
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const credential = await mintIdentity(config);
    // Never overwrite a live gateway credential. The file is outside the client build.
    await writeFile(join(config.directory, 'gateway.json'), JSON.stringify(credential), { flag: 'wx', mode: 0o600 });
    console.log('Gateway credentials saved privately. Configure the world using its publishing identity:');
    console.log(`spacetime call --server ${config.uri.replace(/^ws/, 'http')} ${config.database} configure_access '\"${credential.identity}\"' true`);
    console.log('Admission covers all players in that world. Existing human identities also need grant_player permits. See docs/AGENT_API.md.');
  } else if (command === 'invite') {
    if (args.some(a => !['--combat', '--chat'].includes(a))) throw new Error('Usage: agent:invite [--combat] [--chat]');
    await readCredential(config);
    const code = await new InviteStore(config.directory).issue({ expiresAt: Date.now() + 24 * 3600_000,
      lifetimeSeconds: 3600, combat: args.includes('--combat'), chat: args.includes('--chat') });
    console.log(code);
    console.log('Single use. Redeem within 24 hours for a session lasting at most one hour. Share the code privately, separately from the onboarding URL.');
  } else if (command === 'revoke') {
    if (args.length !== 1 || !/^[a-fA-F0-9]{64}$/.test(args[0])) throw new Error('Usage: agent:revoke -- PLAYER_ID');
    const link = await connect(await readCredential(config), true);
    try { await deadline(link.conn.reducers.revokePlayer({ identity: Identity.fromString(args[0]) })); }
    finally { link.conn.disconnect(); }
    console.log('Player permit revoked.');
  } else throw new Error('Expected setup, invite, or revoke.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
