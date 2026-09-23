import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import type { Credential } from './game';

export function settings() {
  const directory = resolve(process.env.BERIGAME_AGENT_DATA ?? fileURLToPath(new URL('../../.agent-api-data', import.meta.url)));
  const uri = process.env.BERIGAME_AGENT_URI ?? 'ws://127.0.0.1:3000';
  const database = process.env.BERIGAME_AGENT_DB ?? 'berigame';
  const parsed = new URL(uri);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('BERIGAME_AGENT_URI must be a WebSocket origin.');
  if (parsed.protocol !== 'wss:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Use wss for a remote game server.');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(database)) throw new Error('Invalid game database name.');
  const host = process.env.BERIGAME_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.BERIGAME_AGENT_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port.');
  const publicOrigin = process.env.BERIGAME_AGENT_ORIGIN ?? 'http://127.0.0.1:5173';
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('BERIGAME_AGENT_ORIGIN must be an exact HTTP(S) origin.');
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Public API access requires HTTPS at the reverse proxy.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && origin.protocol !== 'https:') throw new Error('An exposed bind address requires an HTTPS public origin.');
  return { directory, uri, database, host, port, publicOrigin,
    trustedProxyIPs: (process.env.BERIGAME_AGENT_TRUSTED_PROXY_IPS ?? '').split(',').map(v => v.trim()).filter(Boolean) };
}

export async function readCredential(config: ReturnType<typeof settings>): Promise<Credential> {
  const file = join(config.directory, 'gateway.json');
  const info = await stat(file);
  if (info.mode & 0o077) throw new Error('gateway.json must have mode 0600.');
  const credential = JSON.parse(await readFile(file, 'utf8')) as Credential;
  if (credential.uri !== config.uri || credential.database !== config.database || typeof credential.token !== 'string'
    || !/^[a-f0-9]{64}$/.test(credential.identity)) throw new Error('Gateway credentials do not match the configured game world.');
  return credential;
}
