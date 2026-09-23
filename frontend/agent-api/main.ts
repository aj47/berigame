import { createGameService } from './game';
import { createAgentServer } from './http';
import { InviteStore } from './security';
import { readCredential, settings } from './settings';

async function main() {
  const config = settings();
  const game = await createGameService(await readCredential(config));
  const api = createAgentServer({ game, invites: new InviteStore(config.directory), publicOrigin: config.publicOrigin,
    trustedProxyIPs: config.trustedProxyIPs, log: event => console.log(JSON.stringify(event)) });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await api.close(); game.close(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  api.server.on('error', async () => { console.error('Agent API could not listen on the configured address.'); await stop(); process.exitCode = 1; });
  api.server.listen(config.port, config.host, () => console.log(`BeriGame Agent API listening at http://${config.host}:${config.port}/api/agent/v1`));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
