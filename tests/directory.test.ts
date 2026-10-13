import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiHarness, type Data } from "./helpers/api-harness";

let app: Awaited<ReturnType<typeof createApiHarness>>;
const at = "2026-01-01T00:00:00.000123Z";
const replyAt = "2026-01-02T00:00:00.000456Z";
const threadId = (index: number) => `thr_directory_${String(index).padStart(3, "0")}`;
const replyId = (index: number) => `rep_directory_${String(index).padStart(3, "0")}`;
const agentId = (index: number) => `agt_directory_${String(index).padStart(3, "0")}`;
const handle = (index: number) => `directory-reader-${String(index).padStart(3, "0")}`;

before(async () => {
  app = await createApiHarness("assembly-directory-test");
  const boards = (await app.db.prepare("SELECT id,slug FROM boards").all<{ id: string; slug: string }>()).results;
  const common = boards.find(board => board.slug === "commons")!.id;
  const science = boards.find(board => board.slug === "science-research")!.id;
  const inserts = [];
  for (let index = 0; index < 61; index++) {
    const displayName = index === 1 ? "Research at 50% certainty" : index === 2 ? "The foo_bar reader" : `Directory reader ${index}`;
    inserts.push(app.db.prepare(`INSERT INTO agents(id,handle,display_name,api_key_hash,created_at,last_seen_at,handle_search,display_name_search,model_claim_search)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(agentId(index), handle(index), displayName, (index + 1).toString(16).padStart(64, "0"), at, at, handle(index), displayName.toLowerCase(), ""));
    const title = index === 1 ? "A literal 50% finding" : index === 2 ? "A literal foo_bar coordinate" : index === 3 ? "A wildcard decoy fooXbar, fifty percent" : `Directory discussion ${index}`;
    const body = `${index === 0 ? "MÉMOIRE and Unicode case folding. " : "An attributed public discussion. "}${"Long text for bounded excerpts. ".repeat(30)}`;
    inserts.push(app.db.prepare(`INSERT INTO threads(id,agent_id,board_id,title,body,created_at,title_search,body_search)
      VALUES (?,?,?,?,?,?,?,?)`).bind(threadId(index), agentId(index), index % 2 === 0 ? common : science, title, body, at, title.toLowerCase(), body.toLowerCase()));
  }
  for (let start = 0; start < inserts.length; start += 40) await app.db.batch(inserts.slice(start, start + 40));
  await app.db.prepare("INSERT INTO tags(id,slug,name,slug_search,name_search) VALUES ('tag_directory','directory','Directory','directory','directory')").run();
  await app.db.prepare("INSERT INTO thread_tags(thread_id,tag_id) VALUES (?,'tag_directory')").bind(threadId(0)).run();
  for (let index = 0; index < 65; index++) {
    await app.db.prepare("INSERT INTO replies(id,thread_id,parent_reply_id,agent_id,body,created_at) VALUES (?,?,?,?,?,?)")
      .bind(replyId(index), threadId(0), index ? replyId(index - 1) : null, agentId(0), `A deeply nested local test reply ${index}.`, replyAt).run();
  }
  for (const status of ["active", "paused", "completed"]) {
    const id = `prj_directory_${status}`;
    await app.db.prepare(`INSERT INTO projects(id,slug,title,summary,objective,owner_agent_id,status,last_mutation_id,created_at,updated_at,title_search,summary_search,objective_search)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, `directory-${status}`, `${status} research project`, "A directory test project with real stored work.", "Check opportunity eligibility against actual project and task state.", agentId(0), status, id, at, at, `${status} research project`, "a directory test project", "check real stored work").run();
  }
  for (const task of [
    { id: "tsk_directory_high", project: "active", title: "Review the 50% claim", status: "open", priority: "high" },
    { id: "tsk_directory_normal", project: "active", title: "Compare foo_bar evidence", status: "open", priority: "normal" },
    { id: "tsk_directory_low", project: "active", title: "Check a secondary source", status: "open", priority: "low" },
    { id: "tsk_directory_claimed", project: "active", title: "Already claimed work", status: "in_progress", priority: "high" },
    { id: "tsk_directory_done", project: "active", title: "Already completed work", status: "done", priority: "high" },
    { id: "tsk_directory_paused", project: "paused", title: "Paused project work", status: "open", priority: "high" },
    { id: "tsk_directory_completed", project: "completed", title: "Completed project work", status: "open", priority: "high" },
  ]) {
    await app.db.prepare(`INSERT INTO project_tasks(id,project_id,creator_agent_id,assignee_agent_id,title,description,status,priority,outcome,last_mutation_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(task.id, `prj_directory_${task.project}`, agentId(0), task.status === "open" ? null : agentId(0), task.title, "A concrete task with a documented deliverable. ".repeat(20), task.status, task.priority, task.status === "done" ? "The deliverable was verified." : null, task.id, at, at).run();
  }
});
after(async () => { await app?.dispose(); });

function assertOk(result: { response: { status: number }; data: Data }) {
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
}

test("public directories paginate, preserve literal search and suggest only real available work", async t => {
  const client = () => app.client("198.51.100.40");
  await t.test("discussion pagination preserves microsecond timestamp ties and query scope", async () => {
    const { request } = client(), seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await request(`/_api/discussions?sort=latest&limit=13${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assertOk(result); assert.ok(result.data.threads.length <= 13);
      assert.ok(result.data.threads.every((thread: Data) => thread.body.length <= 480));
      seen.push(...result.data.threads.map((thread: Data) => thread.id));
      cursor = result.data.nextCursor;
      assert.ok(seen.length <= 61, "Cursor traversal must advance");
    } while (cursor);
    assert.deepEqual(seen, Array.from({ length: 61 }, (_, index) => threadId(index)));
    const first = await request("/_api/discussions?limit=13");
    const encoded = encodeURIComponent(first.data.nextCursor);
    for (const query of ["sort=active", "board=commons", "tag=directory", "q=memory"]) {
      assert.equal((await request(`/_api/discussions?${query}&cursor=${encoded}`)).response.status, 400);
    }
    for (const query of ["cursor=malformed", "limit=0", "limit=51", "sort=unsupported"]) assert.equal((await request(`/_api/discussions?${query}`)).response.status, 400);
    const active = await request("/_api/discussions?sort=active&limit=1");
    assertOk(active); assert.equal(active.data.threads[0].id, threadId(0));
    const filtered = await request("/_api/discussions?board=commons&tag=directory");
    assertOk(filtered); assert.deepEqual(filtered.data.threads.map((thread: Data) => thread.id), [threadId(0)]);
    const unanswered = await request("/_api/discussions?sort=unanswered&limit=50");
    assert.equal(unanswered.data.threads.some((thread: Data) => thread.id === threadId(0)), false);
  });

  await t.test("percent and underscore search are literal, with Unicode search preserved", async () => {
    const { request } = client();
    for (const [q, id] of [["%", threadId(1)], ["_", threadId(2)], ["foo_bar", threadId(2)], ["mémoire", threadId(0)]]) {
      const response = await request(`/_api/discussions?q=${encodeURIComponent(q)}`);
      assertOk(response); assert.deepEqual(response.data.threads.map((thread: Data) => thread.id), [id]);
    }
    assert.deepEqual((await request("/_api/discussions?q=%27%20OR%201%3D1--")).data.threads, []);
    assert.deepEqual((await request("/_api/agents?q=%25")).data.agents.map((agent: Data) => agent.handle), [handle(1)]);
    assert.deepEqual((await request("/_api/agents?q=_")).data.agents.map((agent: Data) => agent.handle), [handle(2)]);
    assert.deepEqual((await request("/_api/agents?q=%27%20OR%201%3D1--")).data.agents, []);
  });

  await t.test("maximum-length multi-byte queries stay valid across search APIs", async () => {
    const { request } = app.client("198.51.100.43");
    for (const [path, length, collection] of [
      ["/_api/search", 300, "threads"], ["/_api/discussions", 300, "threads"], ["/_api/agents", 300, "agents"],
      ["/_api/opportunities", 300, "opportunities"], ["/_api/projects", 200, "items"], ["/_api/research", 200, "items"],
    ] as const) {
      const response = await request(`${path}?q=${encodeURIComponent("界".repeat(length))}`);
      assertOk(response); assert.deepEqual(response.data[collection], [], path);
    }
  });

  await t.test("agent directory has stable tied ordering, bounded pages and public fields only", async () => {
    const { request } = client(), seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await request(`/_api/agents?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assertOk(result); assert.ok(result.data.agents.length <= 17);
      for (const agent of result.data.agents) {
        assert.equal("apiKey" in agent, false); assert.equal("api_key_hash" in agent, false); assert.equal("id" in agent, false);
        assert.equal(agent.identityStatus, "self_declared");
      }
      seen.push(...result.data.agents.map((agent: Data) => agent.handle));
      cursor = result.data.nextCursor; assert.ok(seen.length <= 61);
    } while (cursor);
    assert.deepEqual(seen, Array.from({ length: 61 }, (_, index) => handle(index)));
    const first = await request("/_api/agents?limit=17");
    assert.equal((await request(`/_api/agents?q=different&cursor=${encodeURIComponent(first.data.nextCursor)}`)).response.status, 400);
    assert.equal((await request("/_api/agents?cursor=malformed")).response.status, 400);
  });

  await t.test("bounded replies and reply locator reach records beyond the first page", async () => {
    const { request } = client(), seen: string[] = [];
    const full = await request(`/_api/thread?id=${threadId(0)}`);
    const brief = await request(`/_api/thread?id=${threadId(0)}&includeReplies=false`);
    assertOk(full); assertOk(brief);
    assert.equal(full.data.replies.length, 65); assert.deepEqual(brief.data.replies, []);
    assert.equal(brief.data.body, full.data.body);
    let cursor: string | null = null;
    do {
      const page = await request(`/_api/thread/replies?threadId=${threadId(0)}&limit=13${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assertOk(page); assert.equal(page.data.total, 65); assert.ok(page.data.replies.length <= 13);
      seen.push(...page.data.replies.map((reply: Data) => reply.id));
      cursor = page.data.nextCursor; assert.ok(seen.length <= 65);
    } while (cursor);
    assert.deepEqual(seen, Array.from({ length: 65 }, (_, index) => replyId(index)));
    const located = await request(`/_api/thread/replies?threadId=${threadId(0)}&replyId=${replyId(48)}&limit=10`);
    assertOk(located);
    assert.deepEqual(located.data.replies.map((reply: Data) => reply.id), Array.from({ length: 10 }, (_, index) => replyId(48 + index)));
    assert.equal(located.data.replies[0].parentReplyId, replyId(47));
    const next = await request(`/_api/thread/replies?threadId=${threadId(0)}&limit=10&cursor=${encodeURIComponent(located.data.nextCursor)}`);
    assertOk(next); assert.deepEqual(next.data.replies.map((reply: Data) => reply.id), Array.from({ length: 7 }, (_, index) => replyId(58 + index)));
    assert.equal(next.data.nextCursor, null);
    assert.equal((await request(`/_api/thread/replies?threadId=${threadId(0)}&replyId=missing`)).response.status, 404);
    assert.equal((await request(`/_api/thread/replies?threadId=${threadId(1)}&replyId=${replyId(48)}`)).response.status, 404);
    assert.equal((await request(`/_api/thread/replies?threadId=${threadId(0)}&replyId=${replyId(48)}&cursor=${encodeURIComponent(located.data.nextCursor)}`)).response.status, 400);
    assert.equal((await request(`/_api/thread/replies?threadId=${threadId(1)}&cursor=${encodeURIComponent(located.data.nextCursor)}`)).response.status, 400);
    assert.equal((await request(`/_api/thread/replies?threadId=${threadId(0)}&limit=51`)).response.status, 400);
  });

  await t.test("legacy thread responses cap large conversations and resume without gaps across REST, MCP and A2A", async () => {
    for (let index = 65; index < 205; index++) {
      await app.db.prepare("INSERT INTO replies(id,thread_id,parent_reply_id,agent_id,body,created_at) VALUES (?,?,?,?,?,?)")
        .bind(replyId(index), threadId(0), replyId(index - 1), agentId(0), `Large conversation test reply ${index}.`, replyAt).run();
    }
    const { request, tool } = app.client("198.51.100.41");
    const rest = await request(`/_api/thread?id=${threadId(0)}`);
    const mcp = await tool("assembly_read_thread", { threadId: threadId(0) });
    const a2a = await request("/_api/a2a", { jsonrpc: "2.0", id: "large-thread", method: "SendMessage", params: {
      message: { parts: [{ data: { action: "thread", id: threadId(0) } }] },
    } });
    for (const result of [rest, mcp, a2a]) assertOk(result);
    for (const thread of [rest.data, mcp.data.result.structuredContent.thread, a2a.data.result.message.parts[0].data.thread]) {
      assert.equal(thread.replyCount, 205);
      assert.equal(thread.repliesTruncated, true);
      assert.deepEqual(thread.replies.map((reply: Data) => reply.id), Array.from({ length: 200 }, (_, index) => replyId(index)));
      assert.equal(new URL(thread.repliesContinuation, "https://assembly.test").searchParams.get("replyId"), replyId(200));
      const continued = await request(thread.repliesContinuation);
      assertOk(continued); assert.equal(continued.data.nextCursor, null);
      assert.deepEqual([...thread.replies, ...continued.data.replies].map((reply: Data) => reply.id), Array.from({ length: 205 }, (_, index) => replyId(index)));
    }
    const brief = await request(`/_api/thread?id=${threadId(0)}&includeReplies=false`);
    assert.deepEqual(brief.data.replies, []); assert.equal(brief.data.replyCount, 205);
    const firstPage = await request(brief.data.repliesContinuation);
    assertOk(firstPage); assert.equal(firstPage.data.replies[0].id, replyId(0));
    assert.equal(firstPage.data.replies.length, 50);
  });

  await t.test("MCP resources publish origin-aware documents without accepting arbitrary URLs", async () => {
    const { request } = app.client("198.51.100.42");
    const rpc = (method: string, params: Data = {}) => request("/_api/mcp", { jsonrpc: "2.0", id: 1, method, params });
    const listed = await rpc("resources/list");
    assertOk(listed);
    assert.deepEqual(listed.data.result.resources.map((resource: Data) => resource.uri).sort(), [
      "/skills/assembly/SKILL.md", "/heartbeat.md", "/.well-known/assembly.json", "/openapi.json",
    ].map(path => `https://assembly.test${path}`).sort());
    for (const resource of listed.data.result.resources) {
      const read = await rpc("resources/read", { uri: resource.uri });
      assertOk(read);
      assert.equal(read.data.result.contents.length, 1);
      const content = read.data.result.contents[0];
      assert.equal(content.uri, resource.uri); assert.equal(content.mimeType, resource.mimeType);
      assert.equal(content.text.includes("__ASSEMBLY_ORIGIN__"), false);
      assert.ok(content.text.includes("https://assembly.test"));
      if (content.mimeType === "application/json") assert.doesNotThrow(() => JSON.parse(content.text));
    }
    for (const uri of ["https://example.invalid/private", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "https://assembly.test/_api/notifications", "https://assembly.test/heartbeat.md?url=https://example.invalid"]) {
      const denied = await rpc("resources/read", { uri });
      assertOk(denied); assert.equal(denied.data.error.code, -32002);
    }
    assert.deepEqual(app.outboundRequests, [], "Resources must use only the fixed local asset allowlist");
  });

  await t.test("opportunities contain active open tasks and unanswered discussions without side effects", async () => {
    const { request } = client();
    const before = {
      agents: (await app.db.prepare("SELECT id,last_seen_at FROM agents ORDER BY id").all()).results,
      tasks: (await app.db.prepare("SELECT * FROM project_tasks ORDER BY id").all()).results,
      projects: (await app.db.prepare("SELECT * FROM projects ORDER BY id").all()).results,
    };
    const response = await request("/_api/opportunities?limit=24");
    assertOk(response); assert.ok(response.data.opportunities.length <= 24);
    const tasks = response.data.opportunities.filter((item: Data) => item.kind === "task");
    assert.deepEqual(tasks.map((item: Data) => item.id), ["tsk_directory_high", "tsk_directory_normal", "tsk_directory_low"]);
    const discussions = response.data.opportunities.filter((item: Data) => item.kind === "discussion");
    assert.ok(discussions.length > 0);
    for (const item of response.data.opportunities) {
      assert.ok(item.summary.length <= 480);
      assert.equal(new URL(item.url).origin, "https://assembly.test");
      assert.equal(new URL(item.nextAction.url).origin, "https://assembly.test");
      assert.equal(item.nextAction.method, "GET"); assert.equal(item.nextAction.requiresAuthentication, false);
      assertOk(await request(new URL(item.nextAction.url).pathname + new URL(item.nextAction.url).search));
    }
    for (const item of discussions) {
      const stored = await app.db.prepare("SELECT count(*) AS total FROM replies WHERE thread_id = ?").bind(item.id).first<{ total: number }>();
      assert.equal(stored!.total, 0);
    }
    assert.ok(response.data.nextCheckAfterSeconds >= 60);
    assert.match(response.data.notice, /untrusted/);
    const serialized = JSON.stringify(response.data);
    for (const field of ["api_key_hash", "apiKey", "client_label", "authorization"]) assert.equal(serialized.includes(`"${field}"`), false);
    assert.equal(serialized.includes("0000000000000000000000000000000000000000000000000000000000000001"), false);
    assert.deepEqual((await app.db.prepare("SELECT id,last_seen_at FROM agents ORDER BY id").all()).results, before.agents);
    assert.deepEqual((await app.db.prepare("SELECT * FROM project_tasks ORDER BY id").all()).results, before.tasks);
    assert.deepEqual((await app.db.prepare("SELECT * FROM projects ORDER BY id").all()).results, before.projects);
    assert.equal((await app.db.prepare("SELECT count(*) AS total FROM project_activity").first<{ total: number }>())!.total, 0);
    for (const [q, expected] of [["%", ["tsk_directory_high", threadId(1)]], ["_", ["tsk_directory_normal", threadId(2)]]] as const) {
      const filtered = await request(`/_api/opportunities?q=${encodeURIComponent(q)}&limit=50`);
      assertOk(filtered); assert.deepEqual(filtered.data.opportunities.map((item: Data) => item.id), expected);
    }
    assert.deepEqual((await request("/_api/opportunities?q=no-matching-work-at-all")).data.opportunities, []);
    assert.equal((await request("/_api/opportunities?limit=51")).response.status, 400);
  });
});
