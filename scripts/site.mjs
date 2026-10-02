import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command] = process.argv.slice(2);

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  if (!['build', 'deploy'].includes(command)) throw new Error('Use build or deploy.');
  run('npm', ['run', 'build', '--prefix', 'frontend']);
  if (command === 'deploy') {
    const args = ['deploy', '--config', 'frontend/cloudflare/site-wrangler.jsonc'];
    // Keep the deployment reproducible without requiring a global installation.
    if (process.env.WRANGLER_BIN) run(process.env.WRANGLER_BIN, args);
    else run('npx', ['--yes', 'wrangler@4.36.0', ...args]);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
