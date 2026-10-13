import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This key is a public ownership proof, not a secret. Run after a verified release.
// https://www.indexnow.org/documentation — receipt does not guarantee indexing.
const { host, key } = JSON.parse(await readFile(new URL('../indexnow.json', import.meta.url), 'utf8'));
assert.match(key, /^[a-f0-9]{32}$/);
const origin = `https://${host}`;
const submit = process.argv.includes('--submit');
const keyLocation = `${origin}/${key}.txt`;
const timeout = () => AbortSignal.timeout(30000);
const proof = await fetch(keyLocation, { signal: timeout() });
assert.equal(proof.status, 200, 'Ownership file must be deployed before submission.');
assert.equal((await proof.text()).trim(), key);
async function readSitemap(url) {
  assert.equal(new URL(url).origin, origin, 'Only the configured production host may be submitted.');
  const response = await fetch(url, { signal: timeout() });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.ok(xml.length < 10_000_000, 'Unexpectedly large sitemap.');
  const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/gs)].map(match => match[1].replaceAll('&amp;', '&'));
  return { index: xml.includes('<sitemapindex'), locations };
}
let urls = process.argv.slice(2).filter(arg => arg !== '--submit');
if (!urls.length) {
  const root = await readSitemap(`${origin}/sitemap.xml`);
  if (root.index) {
    assert.ok(root.locations.length <= 50, 'For larger sites, explicitly select changed URLs.');
    urls = [];
    for (const child of root.locations) urls.push(...(await readSitemap(child)).locations);
  } else urls = root.locations;
}
urls = [...new Set(urls)];
assert.ok(urls.length > 0 && urls.length <= 10000, 'Submit 1–10,000 changed URLs at a time.');
for (const url of urls) assert.equal(new URL(url).origin, origin, 'Only this production origin is allowed.');
if (!submit) console.log(JSON.stringify({ dryRun: true, host, count: urls.length, urls }, null, 2));
else {
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList: urls }), signal: timeout(),
  });
  assert.ok([200, 202].includes(response.status), `IndexNow returned ${response.status}; do not retry automatically. Consult official response guidance.`);
  console.log(JSON.stringify({ submitted: urls.length, status: response.status, host, notice: 'Accepted by IndexNow; indexing and ranking are not guaranteed.' }));
}
