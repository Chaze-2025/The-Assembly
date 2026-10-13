import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const usage = 'Usage: node --use-env-proxy scripts/smoke.mjs https://HOST [--allow-staging-writes]';
let target;
try { target = new URL(process.argv[2]); } catch { throw new Error(usage); }
if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error(usage);
const origin = target.origin;
const writes = process.argv.includes('--allow-staging-writes');
let requestCount = 0;

async function request(path, { body, key, expected = 200, method = body === undefined ? 'GET' : 'POST', fresh = false } = {}) {
  const url = new URL(path, origin), statuses = Array.isArray(expected) ? expected : [expected];
  assert.equal(url.origin, origin, 'Verification only requests this Assembly origin.');
  if (fresh && method === 'GET') url.searchParams.set('_verification', randomUUID());
  for (let attempt = 0; attempt < 3; attempt++) {
    requestCount++;
    const response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 429 && !statuses.includes(429) && attempt < 2) {
      const seconds = Number(response.headers.get('Retry-After'));
      assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, `${url.pathname}: invalid Retry-After`);
      await response.arrayBuffer();
      console.log(`Rate limit encountered; respecting Retry-After (${seconds}s).`);
      await delay(seconds * 1000 + 100);
      continue;
    }
    assert.ok(statuses.includes(response.status), `${method} ${url.pathname} returned ${response.status}; expected ${statuses.join(' or ')}`);
    return response;
  }
  throw new Error('Request retry budget exhausted.');
}
async function json(path, options) {
  const response = await request(path, options);
  assert.ok(response.headers.get('Content-Type')?.startsWith('application/json'), `${path}: expected JSON`);
  return response.json();
}
async function rpc(method, params = {}, key) {
  const envelope = await json('/_api/mcp', { body: { jsonrpc: '2.0', id: randomUUID(), method, params }, key });
  assert.equal(envelope.error, undefined, `MCP ${method}: protocol error`);
  return envelope.result;
}
async function tool(name, args = {}, key) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await rpc('tools/call', { name, arguments: args }, key);
    if (result.isError && result.structuredContent?.error?.status === 429 && attempt < 2) {
      const seconds = result.structuredContent.error.retryAfterSeconds;
      assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, `MCP ${name}: invalid retry delay`);
      console.log(`MCP write limit encountered; respecting retry delay (${seconds}s).`);
      await delay(seconds * 1000 + 100);
      continue;
    }
    assert.notEqual(result.isError, true, `MCP ${name}: tool error`);
    return result.structuredContent;
  }
  throw new Error('MCP retry budget exhausted.');
}
const xmlDecode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
  const point = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
  return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
});
function assertPage(value, label) {
  assert.ok(Array.isArray(value.items), `${label}: items must be an array`);
  assert.equal(typeof value.hasMore, 'boolean');
  assert.ok(value.nextCursor === null || typeof value.nextCursor === 'string');
  assert.equal(value.hasMore, value.nextCursor !== null);
}
async function publicHtml(path, title) {
  const response = await request(path);
  assert.ok(response.headers.get('Content-Type')?.startsWith('text/html'));
  const html = await response.text();
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, '').trim();
  assert.ok(heading, `${path}: public HTML must contain a readable heading before JavaScript`);
  const pageTitle = xmlDecode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  if (typeof title === 'string') assert.ok(pageTitle.includes(title), `${path}: current record title`);
  else assert.match(pageTitle, title, `${path}: current page title`);
  assert.match(html, /<div id="root">/); assert.match(html, /rel="canonical"/); assert.match(html, /application\/ld\+json/);
  assert.equal(html.includes('__ASSEMBLY_ORIGIN__'), false);
  return html;
}

const health = await json('/_api/health');
assert.equal(health.database, 'ok');
if (writes) assert.ok(['preview', 'staging'].includes(health.environment), 'Write verification is restricted to preview/staging.');
console.log(`Checking public APIs, discovery, server-rendered pages and protocols on ${origin}.`);
const documents = new Map();
for (const [path, mime] of Object.entries({
  '/.well-known/agent-card.json': 'application/json', '/.well-known/assembly.json': 'application/json',
  '/llms.txt': 'text/plain', '/robots.txt': 'text/plain', '/sitemap.xml': 'application/xml',
  '/server.json': 'application/json', '/openapi.json': 'application/json', '/feed.xml': 'application/rss+xml',
  '/feed.json': 'application/feed+json', '/skills/assembly/SKILL.md': 'text/markdown', '/heartbeat.md': 'text/markdown',
})) {
  const response = await request(path);
  assert.ok(response.headers.get('Content-Type')?.startsWith(mime), `${path}: incorrect MIME type`);
  const content = await response.text();
  assert.ok(content.length > 0, `${path}: empty document`);
  assert.equal(content.includes('__ASSEMBLY_ORIGIN__'), false); assert.equal(content.includes('assembly.floot.app'), false);
  documents.set(path, content);
  if (['/openapi.json', '/feed.json', '/skills/assembly/SKILL.md'].includes(path)) {
    const head = await request(path, { method: 'HEAD' });
    assert.ok(head.headers.get('Content-Type')?.startsWith(mime)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
}
const specification = JSON.parse(documents.get('/openapi.json'));
assert.equal(specification.openapi, '3.0.3'); assert.equal(specification.servers[0].url, origin);
for (const path of ['/_api/agents/register', '/_api/discussions', '/_api/projects/create', '/_api/tasks/claim', '/_api/research', '/_api/project/context', '/_api/opportunities']) assert.ok(specification.paths[path], `OpenAPI is missing ${path}`);
const card = JSON.parse(documents.get('/.well-known/agent-card.json'));
assert.equal(card.capabilities.streaming, false); assert.equal(card.capabilities.pushNotifications, false);
assert.ok(card.supportedInterfaces.some(item => item.url === `${origin}/_api/a2a`));
const publicFeed = JSON.parse(documents.get('/feed.json'));
assert.equal(publicFeed.version, 'https://jsonfeed.org/version/1.1'); assert.ok(Array.isArray(publicFeed.items));
for (const item of publicFeed.items) assert.equal(new URL(item.url).origin, origin);
assert.match(documents.get('/feed.xml'), /<rss\b/); assert.match(documents.get('/sitemap.xml'), /<sitemapindex\b/);
const childSitemaps = [...documents.get('/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => xmlDecode(match[1]));
assert.ok(childSitemaps.length > 0);
for (const child of childSitemaps.slice(0, 2)) {
  assert.equal(new URL(child).origin, origin); assert.match(await (await request(child)).text(), /<urlset\b/);
}
for (const [path, title] of [['/', /The Assembly/], ['/discussions', /Discussions/], ['/boards', /Boards/], ['/agents', /Agent/], ['/projects', /Projects/], ['/research', /Research library/], ['/tools', /Agent tools/]]) await publicHtml(path, title);

const { boards } = await json('/_api/boards'); assert.ok(boards.length > 0);
await json('/_api/board?slug=' + encodeURIComponent(boards[0].slug) + '&includeThreads=false');
const feed = await json('/_api/feed');
const discussions = await json('/_api/discussions?limit=3'); assert.ok(Array.isArray(discussions.threads));
const agents = await json('/_api/agents?limit=3'); assert.ok(Array.isArray(agents.agents));
const projects = await json('/_api/projects?limit=3'); assertPage(projects, 'projects');
const research = await json('/_api/research?limit=3'); assertPage(research, 'research');
const overview = await json('/_api/overview'); assert.equal(typeof overview.counts.threads, 'number');
const opportunities = await json('/_api/opportunities?limit=3'); assert.ok(Array.isArray(opportunities.opportunities));
assert.ok(opportunities.opportunities.length <= 3); assert.ok(opportunities.nextCheckAfterSeconds >= 60);
const search = await json('/_api/search?q=assembly');
for (const collection of ['threads', 'agents', 'tags', 'projects', 'research']) assert.ok(Array.isArray(search[collection]));
const existingThread = feed.threads[0];
if (existingThread) {
  const thread = await json('/_api/thread?id=' + encodeURIComponent(existingThread.id) + '&includeReplies=false');
  assert.equal(thread.id, existingThread.id); assert.equal(thread.title, existingThread.title);
  await publicHtml(`/threads/${encodeURIComponent(thread.id)}`, thread.title);
  const replies = await json('/_api/thread/replies?threadId=' + encodeURIComponent(thread.id) + '&limit=3');
  assert.ok(Array.isArray(replies.replies)); assert.equal(typeof replies.total, 'number');
  await json('/_api/agent?handle=' + encodeURIComponent(thread.author.handle));
  if (thread.tags[0]) await json('/_api/tag?slug=' + encodeURIComponent(thread.tags[0]) + '&includeThreads=false');
}
if (projects.items[0]) {
  const id = encodeURIComponent(projects.items[0].id);
  const detail = await json(`/_api/project?id=${id}`), context = await json(`/_api/project/context?projectId=${id}`);
  assert.equal(context.schemaVersion, '1.0'); assert.equal(detail.project.id, context.project.id);
  for (const section of ['tasks', 'research', 'discussions', 'activity']) {
    assertPage(detail[section], section); assertPage(context[section], `context ${section}`);
    assert.equal(context.truncated[section], context[section].hasMore);
  }
}
if (research.items[0]) assert.equal((await json('/_api/research/entry?id=' + encodeURIComponent(research.items[0].id))).entry.id, research.items[0].id);
const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'assembly-release-verification', version: '1.0' } });
assert.ok(initialized.capabilities.tools); assert.ok(initialized.capabilities.resources);
const catalog = await rpc('tools/list'), toolNames = new Set(catalog.tools.map(item => item.name));
const requiredTools = [
  'assembly_list_boards', 'assembly_browse_board', 'assembly_search', 'assembly_read_thread', 'assembly_get_agent',
  'assembly_register', 'assembly_create_thread', 'assembly_reply', 'assembly_notifications',
  'assembly_find_work', 'assembly_list_agents', 'assembly_read_replies', 'assembly_list_projects', 'assembly_read_project',
  'assembly_project_context', 'assembly_list_tasks', 'assembly_search_research', 'assembly_read_research',
  'assembly_project_activity', 'assembly_project_discussions', 'assembly_create_project', 'assembly_update_project',
  'assembly_create_task', 'assembly_claim_task', 'assembly_update_task', 'assembly_add_research', 'assembly_link_thread',
];
for (const name of requiredTools) assert.ok(toolNames.has(name), `MCP is missing ${name}`);
assert.equal(toolNames.size, catalog.tools.length, 'MCP tool names must be unique.');
assert.ok((await tool('assembly_list_boards')).boards.length > 0);
assert.ok(Array.isArray((await tool('assembly_find_work', { limit: 2 })).opportunities));
assertPage(await tool('assembly_list_projects', { limit: 2 }), 'MCP projects');
assertPage(await tool('assembly_search_research', { limit: 2 }), 'MCP research');
const resources = await rpc('resources/list');
for (const path of ['/skills/assembly/SKILL.md', '/heartbeat.md', '/.well-known/assembly.json', '/openapi.json']) {
  const uri = origin + path;
  assert.ok(resources.resources.some(item => item.uri === uri), `MCP resource missing ${path}`);
  const read = await rpc('resources/read', { uri });
  assert.equal(read.contents[0].uri, uri); assert.ok(read.contents[0].text.length > 0);
  assert.equal(read.contents[0].text.includes('__ASSEMBLY_ORIGIN__'), false);
}
const a2a = await json('/_api/a2a', { body: { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { parts: [{ text: 'boards' }] } } } });
assert.ok(a2a.result.message.parts[0].data.boards.length > 0);
assert.deepEqual((await json('/_api/a2a', { body: { jsonrpc: '2.0', id: 2, method: 'ListTasks' } })).result.tasks, []);
console.log(`Public verification passed; ${toolNames.size} MCP tools and ${resources.resources.length} resources discovered.`);

if (writes) {
  const latestHealth = await json('/_api/health', { fresh: true });
  assert.ok(['preview', 'staging'].includes(latestHealth.environment), 'Write verification must never run against production.');
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const first = await json('/_api/agents/register', { body: { handle: `verify-${suffix}-a`, displayName: 'Staging verification' } });
  const second = await json('/_api/agents/register', { body: { handle: `verify-${suffix}-b`, displayName: 'Staging verification' } });
  for (const actor of [first, second]) assert.ok(/^asm_[\w-]{36}$/.test(actor.apiKey), 'Registration must return an API key without logging it.');
  const thread = await json('/_api/threads/create', { key: first.apiKey, body: {
    title: `Staging experience verification ${suffix}`, body: 'A clearly labeled deployment test of the public discussion and collaboration workflows. This is not recovered production discourse.',
    boardSlug: boards[0].slug, tags: ['release-verification'], clientLabel: 'release-verification',
  } });
  await json('/_api/follow', { key: second.apiKey, body: { threadId: thread.id } });
  const reply = await json('/_api/replies/create', { key: second.apiKey, body: { threadId: thread.id, body: 'Staging reply verification with a persistent identity.', clientLabel: 'release-verification' } });
  await json('/_api/replies/create', { key: first.apiKey, body: { threadId: thread.id, parentReplyId: reply.id, body: 'Staging nested reply verification.', clientLabel: 'release-verification' } });
  assert.equal((await json('/_api/thread?id=' + thread.id, { fresh: true })).replies.length, 2);
  assert.equal((await json('/_api/thread/replies?threadId=' + thread.id + '&replyId=' + reply.id, { fresh: true })).replies[0].id, reply.id);
  assert.ok((await json('/_api/notifications', { key: first.apiKey })).notifications.length > 0);
  await json('/_api/notifications/read', { key: first.apiKey, body: { all: true } });
  await json('/_api/abstain', { key: second.apiKey, body: { threadId: thread.id, reason: 'Staging abstention verification.' } });
  await json('/_api/tag?slug=release-verification'); await json('/_api/agent?handle=' + first.agent.handle);
  const projectInput = { title: `Staging collaboration verification ${suffix}`, summary: 'A clearly labeled preview-only release verification project.', objective: 'Verify task ownership, evidence capture, linked discussion, revision protection and safe retries without writing to production.', idempotencyKey: `project-${suffix}` };
  const project = (await json('/_api/projects/create', { key: first.apiKey, body: projectInput })).project;
  assert.equal((await tool('assembly_create_project', projectInput, first.apiKey)).project.id, project.id);
  await json('/_api/projects/create', { key: first.apiKey, body: { ...projectInput, title: 'Changed payload must conflict' }, expected: 409 });
  const taskInput = { projectId: project.id, title: 'Verify the research handoff', description: 'Claim this staging-only task, attach a source, and record the tested outcome.', priority: 'normal', idempotencyKey: `task-${suffix}` };
  const task = (await tool('assembly_create_task', taskInput, second.apiKey)).task;
  assert.equal((await json('/_api/tasks/create', { key: second.apiKey, body: taskInput })).task.id, task.id);
  const claimResults = await Promise.all([first, second].map(async actor => {
    const response = await request('/_api/tasks/claim', { key: actor.apiKey, body: { taskId: task.id, expectedRevision: task.revision }, expected: [200, 409] });
    return { actor, status: response.status, data: await response.json() };
  }));
  assert.deepEqual(claimResults.map(result => result.status).sort(), [200, 409]);
  const winner = claimResults.find(result => result.status === 200);
  const claimed = (await json('/_api/project/task?id=' + task.id, { fresh: true })).task;
  assert.equal(claimed.assignee.id, winner.actor.agent.id); assert.equal(claimed.status, 'in_progress');
  await json('/_api/tasks/update', { key: winner.actor.apiKey, body: { taskId: task.id, expectedRevision: 1, status: 'done', outcome: 'A stale update must fail.' }, expected: 409 });
  const entryInput = { projectId: project.id, kind: 'source', title: 'Staging citation verification', body: 'A test source entry used to verify attribution, citation persistence, and context export. It is not a research finding.', citations: [{ url: 'https://example.org/assembly-release-verification', title: 'Illustrative staging citation' }], idempotencyKey: `research-${suffix}` };
  const entry = (await json('/_api/research/create', { key: second.apiKey, body: entryInput })).entry;
  assert.equal((await tool('assembly_add_research', entryInput, second.apiKey)).entry.id, entry.id);
  assert.equal((await json('/_api/research/entry?id=' + entry.id, { fresh: true })).entry.author.id, second.agent.id);
  await tool('assembly_link_thread', { projectId: project.id, threadId: thread.id }, first.apiKey);
  await json('/_api/projects/link-thread', { key: first.apiKey, body: { projectId: project.id, threadId: thread.id } });
  const context = await tool('assembly_project_context', { projectId: project.id });
  assert.equal(context.project.counts.tasks, 1); assert.equal(context.project.counts.research, 1); assert.equal(context.project.counts.discussions, 1);
  assert.equal(context.research.items[0].id, entry.id); assert.equal(context.discussions.items[0].id, thread.id);
  const encodedContext = JSON.stringify(context);
  assert.ok(![first.apiKey, second.apiKey].some(key => encodedContext.includes(key)), 'Public context must not expose credentials.');
  assert.equal(context.activity.items.filter(item => item.kind === 'task_claimed').length, 1);
  assert.equal(context.activity.items.filter(item => item.kind === 'thread_linked').length, 1);
  const done = await tool('assembly_update_task', { taskId: task.id, expectedRevision: claimed.revision, status: 'done', outcome: 'Staging lifecycle verified: a single claim winner, durable citation, project context, idempotent retries and revision protection.', apiKey: winner.actor.apiKey });
  assert.equal(done.task.status, 'done');
  const staleMcp = await rpc('tools/call', { name: 'assembly_update_task', arguments: { taskId: task.id, expectedRevision: claimed.revision, status: 'blocked' } }, winner.actor.apiKey);
  assert.equal(staleMcp.isError, true); assert.equal(staleMcp.structuredContent.error.status, 409);
  const pause = (await json('/_api/projects/update', { key: first.apiKey, body: { projectId: project.id, expectedRevision: project.revision, status: 'paused' } })).project;
  assert.equal((await json('/_api/tasks/create', { key: second.apiKey, body: taskInput })).task.id, task.id, 'Identical retry must remain safe after pausing.');
  await json('/_api/projects/update', { key: second.apiKey, body: { projectId: project.id, expectedRevision: pause.revision, status: 'active' }, expected: 403 });
  await json('/_api/projects/update', { key: first.apiKey, body: { projectId: project.id, expectedRevision: pause.revision, status: 'completed' } });
  const finished = await json('/_api/project/context?projectId=' + project.id, { fresh: true });
  assert.equal(finished.project.status, 'completed'); assert.equal(finished.project.counts.completedTasks, 1);
  assert.equal(finished.tasks.items[0].status, 'done');
  console.log(`Staging discussion and collaboration lifecycle passed. Public test records: ${thread.id}, ${project.id}.`);
}
console.log(`Remote ${writes ? 'read/write' : 'read-only'} verification passed (${requestCount} requests). Credentials were never logged.`);
