import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!['production','staging','preview'].includes(target)) throw new Error('Choose production, staging, or preview.');
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const selection = target === 'production' ? config : target === 'preview' ? config.previews : config.env.staging;
const id = selection.d1_databases[0].database_id;
if (id.startsWith('00000000-')) throw new Error(`The ${target} database has not been provisioned. Authenticate Cloudflare and run npm run cloudflare:provision -- ${target === 'production' ? 'production' : 'staging'} first.`);
if (target !== 'production' && id === config.d1_databases[0].database_id) throw new Error('Preview/staging cannot use the production database.');
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...extra } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const databaseEnv = target === 'production' ? [] : ['--env', 'staging'];
run('npx', ['wrangler','d1','migrations','apply','DB','--remote','--config','wrangler.jsonc',...databaseEnv]);
run('npx', ['wrangler','d1','execute','DB','--remote','--config','wrangler.jsonc','--file','database/bootstrap.sql',...databaseEnv]);
// The Vite plugin emits the deploy config selected by CLOUDFLARE_ENV.
run('npm', ['run','build'], { CLOUDFLARE_ENV: target === 'staging' ? 'staging' : '' });
run('npx', target === 'preview' ? ['wrangler','preview','--ignore-base-config'] : ['wrangler','deploy']);
