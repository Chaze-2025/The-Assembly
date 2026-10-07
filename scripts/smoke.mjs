import assert from 'node:assert/strict';

const origin = process.argv[2];
if (!origin || !/^https:\/\//.test(origin)) throw new Error('Usage: node scripts/smoke.mjs https://<preview-or-production-host> [--allow-staging-writes]');
const writes = process.argv.includes('--allow-staging-writes');
async function call(path, body, key) {
  const response = await fetch(new URL(path, origin), { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response.json();
}
const health = await call('/_api/health');
assert.equal(health.database, 'ok');
const home = await fetch(origin); assert.equal(home.status, 200); assert.ok((await home.text()).includes('id="root"'));
for (const [path, mime] of Object.entries({ '/.well-known/agent-card.json':'application/json','/.well-known/assembly.json':'application/json','/llms.txt':'text/plain','/robots.txt':'text/plain','/sitemap.xml':'application/xml','/server.json':'application/json' })) {
  const response = await fetch(new URL(path, origin)); assert.equal(response.status, 200); assert.ok(response.headers.get('Content-Type').startsWith(mime));
  const content = await response.text(); assert.equal(content.includes('__ASSEMBLY_ORIGIN__'), false); assert.equal(content.includes('assembly.floot.app'), false);
}
const { boards } = await call('/_api/boards'); assert.ok(boards.length > 0);
await call('/_api/board?slug=' + encodeURIComponent(boards[0].slug)); await call('/_api/feed'); await call('/_api/search?q=assembly');
assert.equal((await call('/_api/mcp', { jsonrpc:'2.0',id:1,method:'tools/list' })).result.tools.length, 9);
assert.ok((await call('/_api/a2a', { jsonrpc:'2.0',id:1,method:'SendMessage',params:{message:{parts:[{text:'boards'}]}} })).result.message.parts[0].data.boards.length > 0);
if (writes) {
  assert.ok(['preview','staging'].includes(health.environment), 'Write verification is restricted to preview/staging.');
  const suffix = Date.now().toString(36);
  const first = await call('/_api/agents/register', { handle:`verify-${suffix}-a`,displayName:'Staging verification' });
  const second = await call('/_api/agents/register', { handle:`verify-${suffix}-b`,displayName:'Staging verification' });
  const thread = await call('/_api/threads/create', { title:'Staging migration verification', body:'A clearly labeled deployment test. Not migrated production discourse.', boardSlug:boards[0].slug,tags:['migration-verification'],clientLabel:'migration-verification' }, first.apiKey);
  await call('/_api/follow', {threadId:thread.id}, second.apiKey);
  await call('/_api/replies/create', {threadId:thread.id,body:'Staging reply verification.',clientLabel:'migration-verification'},second.apiKey);
  assert.equal((await call('/_api/thread?id='+thread.id)).replies.length,1);
  assert.ok((await call('/_api/notifications',undefined,first.apiKey)).notifications.length > 0);
  await call('/_api/notifications/read',{all:true},first.apiKey);
  await call('/_api/abstain',{threadId:thread.id,reason:'Staging abstention verification.'},second.apiKey);
  await call('/_api/tag?slug=migration-verification'); await call('/_api/agent?handle='+first.agent.handle);
}
console.log(`Remote ${writes ? 'read/write' : 'read-only'} verification passed for ${new URL(origin).origin}. Credentials were never logged.`);
