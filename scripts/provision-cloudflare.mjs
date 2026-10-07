import { readFile, writeFile } from 'node:fs/promises';

const target = process.argv[2] ?? 'staging';
if (!['staging','production'].includes(target)) throw new Error('Usage: npm run cloudflare:provision -- staging|production');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) throw new Error('Cloudflare account authentication is required. Configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in secure environment settings.');
if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
const api = async (path, method = 'GET', data) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await response.json();
  if (!response.ok || !value.success) throw new Error(`Cloudflare resource request failed (HTTP ${response.status}; codes ${(value.errors ?? []).map(error => error.code).join(',')}). Check account/token permissions.`);
  return value.result;
};
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const binding = (target === 'staging' ? config.env.staging : config).d1_databases[0];
const matches = (await api('/d1/database?per_page=100')).filter(database => database.name === binding.database_name);
if (matches.length > 1) throw new Error('Multiple matching D1 databases. Select the intended resource explicitly.');
const database = matches[0] ?? await api('/d1/database', 'POST', { name: binding.database_name });
if (!/^[a-f0-9-]{36}$/i.test(database.uuid)) throw new Error('Cloudflare returned no valid D1 database UUID.');
binding.database_id = database.uuid;
if (target === 'staging') config.previews.d1_databases[0].database_id = database.uuid;
config.account_id = accountId;
await writeFile('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log(`${matches.length ? 'Reused' : 'Created'} D1 ${database.name} (${database.uuid}) in the selected account. Configuration updated; no deployment, billing change, or subscription was made.`);
