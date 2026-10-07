import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
const root = "https://assembly.test";
type Data = Record<string, any>; // Test-only decoded JSON; contracts are checked by assertions below.

before(async () => {
  const bundle = await build({ entryPoints: ["worker/index.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "assembly-test", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    bindings: { DEPLOYMENT_ENV: "staging", ALLOWED_ORIGINS: "https://trusted.test" }, d1Databases: ["DB"],
    ratelimits: {
      API_LIMITER: { namespace_id: "1", simple: { limit: 120, period: 60 } },
      REGISTER_LIMITER: { namespace_id: "2", simple: { limit: 5, period: 60 } },
      WRITE_LIMITER: { namespace_id: "3", simple: { limit: 30, period: 60 } },
    }, assets: { directory: "public", binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
  }] }));
  db = await mf.getD1Database("DB");
  for (const file of ["database/migrations/0001_schema.sql", "database/bootstrap.sql"]) {
    for (const sql of (await readFile(file, "utf8")).split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
  }
});
after(async () => { await mf?.dispose(); });

async function request(path: string, body?: unknown, key?: string, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "192.0.2.1");
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const response = await mf.dispatchFetch(root + path, { method: body === undefined ? "GET" : "POST", headers: Object.fromEntries(headers), body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 500) throw new Error(await response.text());
  const data = response.headers.get("content-type")?.includes("json") ? await response.json() as Data : {};
  return { response, data };
}
async function register(handle: string, ip = "192.0.2.1") {
  const { response, data } = await request("/_api/agents/register", { handle, modelClaim: "Research Agent" }, undefined, { "cf-connecting-ip": ip });
  assert.equal(response.status, 200); assert.match(data.apiKey, /^asm_[\w-]{36}$/); return data;
}
async function resetCooldowns() { await db.prepare("DELETE FROM write_cooldowns").run(); }
async function rpc(method: string, params: Data = {}, ip = "192.0.2.1") {
  return request("/_api/mcp", { jsonrpc: "2.0", id: 1, method, params }, undefined, { "cf-connecting-ip": ip });
}

test("REST, database, auth, notifications, MCP, A2A, and discovery integration", async t => {
  let alice: Data, bob: Data, carol: Data, dave: Data, threadId: string, replyId: string;
  await t.test("schema, directory, health and stable endpoint errors", async () => {
    assert.equal((await request("/_api/health")).data.boardCount, 7);
    const boards = (await request("/_api/boards")).data.boards;
    assert.deepEqual(boards.map((board: Data) => board.slug), ["commons", "philosophy-mind", "science-research", "problems-collaboration", "ai-computation", "society", "assembly-meta"]);
    assert.equal(boards[0].threadCount, 0); assert.equal(boards[0].latestActivityAt, null);
    assert.equal((await request("/_api/board")).response.status, 400);
    assert.equal((await request("/_api/thread?id=missing")).response.status, 404);
    assert.equal((await request("/_api/not-an-endpoint")).response.status, 404);
  });
  await t.test("register credentials once and preserve case-sensitive identities", async () => {
    alice = await register("alice"); bob = await register("bob"); carol = await register("carol"); dave = await register("dave");
    assert.equal((await request("/_api/agents/register", { handle: "alice" })).response.status, 409);
    assert.equal((await request("/_api/agents/register", { handle: "x" })).response.status, 400);
    const stored = await db.prepare("SELECT api_key_hash FROM agents WHERE handle = 'alice'").first<{ api_key_hash: string }>();
    assert.match(stored!.api_key_hash, /^[a-f0-9]{64}$/); assert.notEqual(stored!.api_key_hash, alice.apiKey);
    const profile = (await request("/_api/agent?handle=alice")).data;
    assert.equal(profile.agent.identityStatus, "self_declared"); assert.equal(profile.agent.threadCount, 0);
    assert.equal(JSON.stringify(profile).includes(stored!.api_key_hash), false); assert.equal(JSON.stringify(profile).includes(alice.apiKey), false);
    assert.equal((await request("/_api/agent?handle=Alice")).response.status, 404);
  });
  await t.test("auth, input validation, unknown boards and JSON requirements", async () => {
    assert.equal((await request("/_api/threads/create", { title: "Test", body: "hello" })).response.status, 401);
    assert.equal((await request("/_api/threads/create", { title: "Test", body: "hello" }, "wrong")).response.status, 401);
    assert.equal((await request("/_api/threads/create", { title: "x", body: "hello" }, alice.apiKey)).response.status, 400);
    assert.equal((await request("/_api/threads/create", { title: "Test", body: "hello", boardSlug: "missing" }, alice.apiKey)).response.status, 400);
    const noJson = await mf.dispatchFetch(root + "/_api/agents/register", { method: "POST", body: "{}" });
    assert.equal(noJson.status, 415);
  });
  await t.test("create a tagged, mentioned thread; feed and public records", async () => {
    const { response, data } = await request("/_api/threads/create", { title: "What is MÉMOIRE?", body: "An open question for @bob.", tags: ["Ethics", "ethics", "multi_agent"] }, alice.apiKey);
    assert.equal(response.status, 200); threadId = data.id;
    assert.deepEqual(data.tags, ["ethics", "multi-agent"]); assert.equal(data.boardSlug, "commons");
    assert.match(data.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const thread = (await request(`/_api/thread?id=${threadId}`)).data;
    assert.equal(thread.author.handle, "alice"); assert.equal(thread.provenance, "api_authenticated");
    assert.deepEqual(thread.tags, ["ethics", "multi-agent"]); assert.equal(thread.replies.length, 0);
    assert.equal((await request("/_api/feed?sort=unanswered")).data.threads[0].id, threadId);
    assert.equal((await request("/_api/boards")).data.boards[0].threadCount, 1);
    assert.equal((await request("/_api/board?slug=commons")).data.threads[0].replyCount, 0);
    assert.equal((await request("/_api/tag?slug=ethics")).data.tag.threadCount, 1);
    assert.equal((await request("/_api/notifications", undefined, bob.apiKey)).data.notifications[0].kind, "mention");
  });
  await t.test("cooldown is atomic under concurrent writes", async () => {
    assert.equal((await request("/_api/threads/create", { title: "Too soon", body: "cooldown" }, alice.apiKey)).response.status, 429);
    await resetCooldowns();
    const responses = await Promise.all([1, 2].map(value => request("/_api/threads/create", { title: `Parallel ${value}`, body: "atomic cooldown", tags: ["ethics"] }, alice.apiKey)));
    assert.deepEqual(responses.map(value => value.response.status).sort(), [200, 429]);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tags WHERE slug = 'ethics'").first<{ count: number }>())!.count, 1);
  });
  await t.test("follow and reply fanout; parent replies stay in their thread", async () => {
    assert.equal((await request("/_api/follow", { threadId }, carol.apiKey)).data.following, true);
    const reply = await request("/_api/replies/create", { threadId, body: "A response for @dave." }, bob.apiKey);
    assert.equal(reply.response.status, 200); replyId = reply.data.id;
    assert.equal((await request("/_api/notifications", undefined, alice.apiKey)).data.notifications[0].kind, "reply");
    assert.equal((await request("/_api/notifications", undefined, carol.apiKey)).data.notifications[0].kind, "thread_activity");
    assert.equal((await request("/_api/notifications", undefined, dave.apiKey)).data.notifications[0].kind, "mention");
    const nested = await request("/_api/replies/create", { threadId, parentReplyId: replyId, body: "A nested answer." }, alice.apiKey);
    assert.equal(nested.response.status, 200);
    const thread = (await request(`/_api/thread?id=${threadId}`)).data;
    assert.equal(thread.replies.length, 2); assert.equal(thread.replies[1].parentReplyId, replyId);
    const other = await request("/_api/threads/create", { title: "A separate thread", body: "Different context" }, carol.apiKey);
    assert.equal((await request("/_api/replies/create", { threadId: other.data.id, parentReplyId: replyId, body: "bad parent" }, dave.apiKey)).response.status, 400);
    assert.equal((await request("/_api/feed?sort=unanswered")).data.threads.some((thread: Data) => thread.id === threadId), false);
    assert.ok((await request("/_api/feed?sort=active")).data.threads.length > 0);
  });
  await t.test("all side effects roll back when a database batch fails", async () => {
    await resetCooldowns();
    const before = (await db.prepare("SELECT count(*) AS count FROM replies").first<{ count: number }>())!.count;
    await db.prepare("CREATE TRIGGER fail_notifications BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    assert.equal((await request("/_api/replies/create", { threadId, body: "Should roll back" }, bob.apiKey)).response.status, 503);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM replies").first<{ count: number }>())!.count, before);
    await db.prepare("DROP TRIGGER fail_notifications").run();
  });
  await t.test("notification ownership, mark-one/all, alternate auth and unfollow", async () => {
    const carolNotification = (await request("/_api/notifications", undefined, carol.apiKey)).data.notifications[0].id;
    assert.equal((await request("/_api/notifications/read", { ids: [carolNotification] }, alice.apiKey)).data.markedRead, 0);
    const notifications = await request("/_api/notifications", undefined, undefined, { "x-assembly-key": alice.apiKey });
    assert.equal(notifications.response.status, 200);
    const id = notifications.data.notifications[0].id;
    assert.equal((await request("/_api/notifications/read", { ids: [id] }, alice.apiKey)).data.markedRead, 1);
    assert.equal((await request("/_api/notifications/read", { all: true }, alice.apiKey)).response.status, 200);
    assert.equal((await request("/_api/notifications/read", {}, alice.apiKey)).response.status, 400);
    assert.equal((await request("/_api/follow", { threadId, follow: false }, carol.apiKey)).data.following, false);
    assert.equal((await request("/_api/notifications")).response.status, 401);
  });
  await t.test("Unicode case-insensitive search, profiles and injection resistance", async () => {
    const result = await request("/_api/search?q=m%C3%A9moire");
    assert.equal(result.data.threads[0].id, threadId);
    assert.equal((await request("/_api/search?q=alice")).data.agents[0].handle, "alice");
    assert.equal((await request("/_api/search?q=ethics")).data.tags[0].slug, "ethics");
    assert.equal((await request("/_api/search?q=%27%20OR%201%3D1--")).data.threads.length, 0);
    assert.equal((await request("/_api/search?q=x")).data.threads.length, 0);
    assert.ok((await request("/_api/agent?handle=alice")).data.recentReplies.length > 0);
    assert.equal((await request("/_api/search?q=" + "x".repeat(301))).response.status, 400);
  });
  await t.test("explicit abstention persists as a distinct action", async () => {
    const abstention = await request("/_api/abstain", { threadId, reason: "Insufficient evidence." }, dave.apiKey);
    assert.equal(abstention.response.status, 200); assert.equal(abstention.data.recorded, true);
    assert.equal((await request("/_api/abstain", {}, dave.apiKey)).data.recorded, true);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM abstentions").first<{ count: number }>())!.count, 2);
  });
  await t.test("security headers, origin policy, preflight and streaming size limit", async () => {
    const publicRead = await request("/_api/feed", undefined, undefined, { Origin: "https://untrusted.test" });
    assert.equal(publicRead.response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(publicRead.response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal((await request("/_api/abstain", {}, alice.apiKey, { Origin: "https://untrusted.test" })).response.status, 403);
    assert.equal((await request("/_api/abstain", {}, alice.apiKey, { Origin: "https://trusted.test" })).response.status, 200);
    const preflight = await mf.dispatchFetch(root + "/_api/threads/create", { method: "OPTIONS", headers: { Origin: root } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), root);
    const oversized = await mf.dispatchFetch(root + "/_api/agents/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "large", data: "x".repeat(70000) }) });
    assert.equal(oversized.status, 413);
  });
  await t.test("MCP lifecycle, original tools, structured reads and malformed RPC", async () => {
    assert.equal((await rpc("initialize", { protocolVersion: "2025-03-26" })).data.result.protocolVersion, "2025-03-26");
    assert.equal((await rpc("tools/list")).data.result.tools.length, 9);
    assert.ok((await rpc("server/discover")).data.result.supportedVersions.includes("2026-07-28"));
    const read = await rpc("tools/call", { name: "assembly_read_thread", arguments: { threadId } });
    assert.equal(read.data.result.structuredContent.thread.replies.length, 2);
    assert.equal((await rpc("tools/call", { name: "assembly_list_boards" })).data.result.structuredContent.boards.length, 7);
    assert.equal((await rpc("tools/call", { name: "assembly_browse_board", arguments: { boardSlug: "commons" } })).data.result.isError, undefined);
    assert.equal((await rpc("tools/call", { name: "assembly_get_agent", arguments: { handle: "@alice" } })).data.result.structuredContent.agent.handle, "alice");
    assert.equal((await rpc("tools/call", { name: "assembly_search", arguments: { query: "mémoire" } })).data.result.structuredContent.threads[0].id, threadId);
    assert.equal((await rpc("unknown")).data.error.code, -32601);
    const notification = await request("/_api/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notification.response.status, 202);
    const malformed = await mf.dispatchFetch(root + "/_api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal((await malformed.json() as Data).error.code, -32700);
    assert.equal((await request("/_api/mcp", null)).data.error.code, -32600);
    assert.equal((await request("/_api/mcp")).response.status, 405);
  });
  await t.test("MCP registration and writes share auth, cooldown, tags and notifications", async () => {
    const registered = await rpc("tools/call", { name: "assembly_register", arguments: { handle: "mcp-agent" } }, "192.0.2.10");
    const key = registered.data.result.structuredContent.apiKey;
    assert.match(key, /^asm_/);
    const create = await rpc("tools/call", { name: "assembly_create_thread", arguments: { apiKey: key, title: "MCP discussion", body: "A question for @dave", tags: ["protocol"] } });
    const id = create.data.result.structuredContent.id;
    assert.equal(create.data.result.structuredContent.url, `${root}/threads/${id}`);
    const tooSoon = await rpc("tools/call", { name: "assembly_create_thread", arguments: { apiKey: key, title: "Cooldown", body: "too soon" } });
    assert.equal(tooSoon.data.result.isError, true);
    await resetCooldowns();
    const reply = await rpc("tools/call", { name: "assembly_reply", arguments: { apiKey: bob.apiKey, threadId: id, body: "@dave replied through MCP" } });
    assert.equal(reply.data.result.isError, undefined);
    assert.equal((await rpc("tools/call", { name: "assembly_notifications", arguments: { apiKey: key } })).data.result.structuredContent.notifications[0].kind, "reply");
    assert.equal((await rpc("tools/call", { name: "assembly_reply", arguments: { apiKey: "invalid", threadId, body: "no" } })).data.result.isError, true);
    assert.equal((await rpc("tools/call", { name: "assembly_create_thread", arguments: { apiKey: key, title: "Invalid tags", body: "check", tags: ["bad tag"] } })).data.result.isError, true);
  });
  await t.test("A2A discovery, structured/text requests, public profiles and no writes", async () => {
    const send = async (parts: Data[]) => (await request("/_api/a2a", { jsonrpc: "2.0", id: "a", method: "SendMessage", params: { message: { parts, contextId: "ctx_test" } } })).data;
    const boards = await send([{ text: "boards" }]);
    assert.equal(boards.result.message.contextId, "ctx_test"); assert.equal(boards.result.message.parts[0].data.boards.length, 7);
    assert.equal((await send([{ data: { action: "thread", id: threadId } }])).result.message.parts[0].data.thread.id, threadId);
    assert.equal((await send([{ text: "agent: alice" }])).result.message.parts[0].data.agent.handle, "alice");
    assert.equal((await send([{ text: "search: mémoire" }])).result.message.parts[0].data.threads[0].id, threadId);
    assert.equal((await send([{ text: "thread: missing" }])).result.message.parts[0].data.thread, null);
    assert.ok((await send([{ text: "create-thread" }])).result.message.parts[0].text.includes(`${root}/llms.txt`));
    assert.deepEqual((await request("/_api/a2a", { jsonrpc: "2.0", id: 1, method: "ListTasks" })).data.result.tasks, []);
  });
  await t.test("public discovery files have real origin URLs and correct MIME types", async () => {
    for (const [path, expected] of Object.entries({ "/.well-known/agent-card.json": "application/json", "/.well-known/assembly.json": "application/json", "/server.json": "application/json", "/llms.txt": "text/plain", "/robots.txt": "text/plain", "/sitemap.xml": "application/xml" })) {
      const response = await mf.dispatchFetch(root + path);
      assert.equal(response.status, 200, path); assert.ok(response.headers.get("content-type")!.startsWith(expected), path);
      const text = await response.text(); assert.equal(text.includes("__ASSEMBLY_ORIGIN__"), false); assert.equal(text.includes("assembly.floot.app"), false);
      if (expected === "application/json") JSON.parse(text);
      if (path === "/.well-known/agent-card.json") assert.ok(text.includes(`${root}/_api/a2a`));
      if (path === "/sitemap.xml") assert.ok(text.includes(`${root}/boards/commons`));
    }
    const head = await mf.dispatchFetch(root + "/llms.txt", { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  });
  await t.test("registration abuse limit applies across REST and MCP", async () => {
    for (let i = 0; i < 5; i++) await register(`rate-agent-${i}`, "192.0.2.200");
    const blocked = await rpc("tools/call", { name: "assembly_register", arguments: { handle: "rate-blocked" } }, "192.0.2.200");
    assert.equal(blocked.data.result.isError, true);
    assert.equal((await request("/_api/agents/register", { handle: "rate-blocked" }, undefined, { "cf-connecting-ip": "192.0.2.200" })).response.status, 429);
  });
  await t.test("large valid mention and notification arrays fit D1 parameter limits", async () => {
    await resetCooldowns();
    const body = Array.from({ length: 160 }, (_, index) => `@unknown-agent-${index}`).join(" ") + " @bob";
    const created = await request("/_api/threads/create", { title: "Large valid mention list", body }, alice.apiKey, { "cf-connecting-ip": "192.0.2.88" });
    assert.equal(created.response.status, 200);
    const reply = await request("/_api/replies/create", { threadId: created.data.id, body }, dave.apiKey, { "cf-connecting-ip": "192.0.2.88" });
    assert.equal(reply.response.status, 200);
    const read = await request("/_api/notifications/read", { ids: Array.from({ length: 100 }, (_, index) => `missing-${index}`) }, alice.apiKey, { "cf-connecting-ip": "192.0.2.88" });
    assert.equal(read.response.status, 200); assert.equal(read.data.markedRead, 0);
  });
});
