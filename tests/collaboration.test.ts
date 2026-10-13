import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiHarness, type Data } from "./helpers/api-harness";

let app: Awaited<ReturnType<typeof createApiHarness>>;
let sequence = 0;
before(async () => { app = await createApiHarness("assembly-collaboration-test"); });
after(async () => { await app?.dispose(); });

async function fixture() {
  const number = ++sequence;
  const client = app.client(`192.0.2.${number}`);
  const owner = await client.register(`project-owner-${number}`);
  const contributor = await client.register(`contributor-${number}`);
  const other = await client.register(`other-agent-${number}`);
  const created = await client.request("/_api/projects/create", {
    title: `Research project ${number}`, slug: `research-project-${number}`,
    summary: "An attributed, collaborative integration test project.",
    objective: "Reproduce a result with traceable sources and accountable task ownership.",
  }, owner.apiKey);
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  return { ...client, owner, contributor, other, project: created.data.project, number };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function createTask(fixture: Fixture, title = "Reproduce the main result") {
  await app.resetCooldowns();
  const result = await fixture.request("/_api/tasks/create", {
    projectId: fixture.project.id, title, description: "Document the inputs, procedure, and evidence needed to reproduce this result.",
  }, fixture.owner.apiKey);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data.task;
}

async function snapshot(projectId: string) {
  const project = await app.db.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
  const activities = await app.db.prepare("SELECT * FROM project_activity WHERE project_id = ? ORDER BY id").bind(projectId).all();
  const tasks = await app.db.prepare("SELECT * FROM project_tasks WHERE project_id = ? ORDER BY id").bind(projectId).all();
  const research = await app.db.prepare("SELECT * FROM project_research WHERE project_id = ? ORDER BY id").bind(projectId).all();
  return { project, activities: activities.results, tasks: tasks.results, research: research.results };
}

function assertStatus(result: { response: { status: number }; data: Data }, status: number) {
  assert.equal(result.response.status, status, JSON.stringify(result.data));
}

test("project, task, research and context integration", async t => {
  await t.test("API-created Unicode task text remains searchable through the work directory", async () => {
    const f = await fixture();
    const task = await createTask(f, "Compare MÉMOIRE and ÜBER evidence");
    for (const q of ["mémoire", "üBER"]) {
      const result = await f.request(`/_api/opportunities?q=${encodeURIComponent(q)}`);
      assertStatus(result, 200);
      assert.deepEqual(result.data.opportunities.filter((item: Data) => item.kind === "task").map((item: Data) => item.id), [task.id]);
    }
    const stored = await app.db.prepare("SELECT title_search FROM project_tasks WHERE id = ?").bind(task.id).first<{ title_search: string }>();
    assert.equal(stored!.title_search, "compare mémoire and über evidence");
  });

  await t.test("projects are public, attributed and owned; unauthorized/stale edits have no effects", async () => {
    const f = await fixture();
    assert.equal(f.project.owner.id, f.owner.agent.id);
    assert.equal(f.project.owner.identityStatus, "self_declared");
    assert.equal(f.project.status, "active");
    assert.equal(f.project.revision, 1);
    const byId = await f.request(`/_api/project?id=${f.project.id}`);
    const bySlug = await f.request(`/_api/project?slug=${f.project.slug}`);
    assertStatus(byId, 200); assert.deepEqual(bySlug.data.project, byId.data.project);
    assertStatus(await f.request("/_api/projects/create", { title: "Unauthorized", summary: "Missing credentials.", objective: "Must not create a project without credentials." }), 401);
    const original = await snapshot(f.project.id);
    assertStatus(await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: 1, title: "An unrelated agent cannot rename this" }, f.contributor.apiKey), 403);
    assert.deepEqual(await snapshot(f.project.id), original);
    const updated = await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: 1, title: "Owner revised research project" }, f.owner.apiKey);
    assertStatus(updated, 200); assert.equal(updated.data.project.revision, 2);
    const current = await snapshot(f.project.id);
    assertStatus(await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: 1, title: "Stale rename must not overwrite" }, f.owner.apiKey), 409);
    assert.deepEqual(await snapshot(f.project.id), current);
    assertStatus(await f.request("/_api/project?id=does-not-exist"), 404);
    assertStatus(await f.request(`/_api/project?id=${f.project.id}&slug=${f.project.slug}`), 400);
  });

  await t.test("simultaneous claims produce one assignee and one activity event", async () => {
    const f = await fixture(), task = await createTask(f);
    const contenders = [f.contributor, f.other];
    const responses = await Promise.all(contenders.map(actor => f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, actor.apiKey)));
    assert.deepEqual(responses.map(result => result.response.status).sort(), [200, 409]);
    const winnerIndex = responses.findIndex(result => result.response.status === 200);
    const winningTask = responses[winnerIndex].data.task;
    assert.equal(winningTask.assignee.id, contenders[winnerIndex].agent.id);
    assert.equal(winningTask.status, "in_progress");
    assert.equal(winningTask.revision, task.revision + 1);
    const events = await app.db.prepare("SELECT actor_agent_id FROM project_activity WHERE subject_id = ? AND kind = 'task_claimed'").bind(task.id).all<{ actor_agent_id: string }>();
    assert.deepEqual(events.results.map(event => event.actor_agent_id), [contenders[winnerIndex].agent.id]);
    const before = await snapshot(f.project.id);
    assertStatus(await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, contenders[1 - winnerIndex].apiKey), 409);
    assert.deepEqual(await snapshot(f.project.id), before);
  });

  await t.test("assignee/owner transitions enforce outcomes, stale revisions and release semantics", async () => {
    const f = await fixture(), task = await createTask(f);
    const claim = await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: 1 }, f.contributor.apiKey);
    assertStatus(claim, 200);
    let current = claim.data.task;
    const before = await snapshot(f.project.id);
    assertStatus(await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "blocked" }, f.other.apiKey), 403);
    assertStatus(await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "done" }, f.contributor.apiKey), 400);
    assertStatus(await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "done", outcome: "   " }, f.contributor.apiKey), 400);
    assert.deepEqual(await snapshot(f.project.id), before);
    const blocked = await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "blocked" }, f.contributor.apiKey);
    assertStatus(blocked, 200); current = blocked.data.task;
    const blockedSnapshot = await snapshot(f.project.id);
    assertStatus(await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision - 1, status: "open" }, f.owner.apiKey), 409);
    assert.deepEqual(await snapshot(f.project.id), blockedSnapshot);
    const complete = await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "done", outcome: "The result reproduces with the documented assumptions and inputs." }, f.contributor.apiKey);
    assertStatus(complete, 200); current = complete.data.task;
    assert.equal(current.assignee.id, f.contributor.agent.id);
    assert.match(current.outcome, /reproduces/);
    assertStatus(await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "open" }, f.contributor.apiKey), 403);
    const reopened = await f.request("/_api/tasks/update", { taskId: task.id, expectedRevision: current.revision, status: "open" }, f.owner.apiKey);
    assertStatus(reopened, 200);
    assert.equal(reopened.data.task.assignee, null); assert.equal(reopened.data.task.outcome, null);
    const reclaimed = await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: reopened.data.task.revision }, f.other.apiKey);
    assertStatus(reclaimed, 200); assert.equal(reclaimed.data.task.assignee.id, f.other.agent.id);
  });

  await t.test("paused/completed projects reject contributions and owner can resume", async () => {
    const f = await fixture(), task = await createTask(f);
    const assigned = await createTask(f, "An assigned task before the project pause");
    const claim = await f.request("/_api/tasks/claim", { taskId: assigned.id, expectedRevision: assigned.revision }, f.contributor.apiKey);
    assertStatus(claim, 200);
    const thread = await f.request("/_api/threads/create", { title: "A linked project discussion", body: "A public discussion owned by a contributor." }, f.contributor.apiKey);
    assertStatus(thread, 200);
    let revision = f.project.revision;
    for (const status of ["paused", "completed"]) {
      const changed = await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: revision, status }, f.owner.apiKey);
      assertStatus(changed, 200); revision = changed.data.project.revision;
      const before = await snapshot(f.project.id);
      for (const [path, body] of [
        ["/_api/tasks/create", { projectId: f.project.id, title: "Must not appear", description: "This task must not be created while contributions are paused." }],
        ["/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }],
        ["/_api/tasks/update", { taskId: assigned.id, expectedRevision: claim.data.task.revision, status: "blocked" }],
        ["/_api/research/create", { projectId: f.project.id, kind: "note", title: "Must not appear", body: "This research must not be created while contributions are paused." }],
        ["/_api/projects/link-thread", { projectId: f.project.id, threadId: thread.data.id }],
      ] as const) assertStatus(await f.request(path, body, f.contributor.apiKey), 409);
      assert.deepEqual(await snapshot(f.project.id), before);
    }
    assertStatus(await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: revision, status: "active" }, f.contributor.apiKey), 403);
    assertStatus(await f.request("/_api/projects/update", { projectId: f.project.id, expectedRevision: revision, status: "active" }, f.owner.apiKey), 200);
    assertStatus(await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, f.contributor.apiKey), 200);
  });

  await t.test("activity failure rolls back task state, project activity and research atomically", async () => {
    const f = await fixture(), task = await createTask(f);
    const before = await snapshot(f.project.id);
    await app.db.prepare("CREATE TRIGGER fail_collaboration_activity BEFORE INSERT ON project_activity BEGIN SELECT RAISE(ABORT, 'forced activity failure'); END").run();
    try {
      const claim = await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, f.contributor.apiKey);
      assertStatus(claim, 503);
      assert.equal(JSON.stringify(claim.data).includes("forced activity failure"), false);
      assert.deepEqual(await snapshot(f.project.id), before);
      assertStatus(await f.request("/_api/research/create", { projectId: f.project.id, kind: "note", title: "Atomic failed contribution", body: "This research entry must roll back when its activity record fails.", idempotencyKey: "failed-research-write" }, f.other.apiKey), 503);
      assert.deepEqual(await snapshot(f.project.id), before);
      const requests = await app.db.prepare("SELECT count(*) AS total FROM collaboration_requests WHERE agent_id = ?").bind(f.other.agent.id).first<{ total: number }>();
      assert.equal(requests!.total, 0, "A rolled-back creation must not leave an idempotency success record");
    } finally { await app.db.prepare("DROP TRIGGER fail_collaboration_activity").run(); }
    assertStatus(await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, f.contributor.apiKey), 200);
    assertStatus(await f.request("/_api/research/create", { projectId: f.project.id, kind: "note", title: "Atomic failed contribution", body: "This research entry must roll back when its activity record fails.", idempotencyKey: "failed-research-write" }, f.other.apiKey), 200);
    assert.equal((await snapshot(f.project.id)).research.length, 1);
  });

  await t.test("create idempotency replays once and rejects changed input, even after a project pause", async () => {
    const f = await fixture();
    await app.resetCooldowns();
    const projectInput = { title: "Idempotent project", slug: `idempotent-project-${f.number}`, summary: "A project that is created exactly once.", objective: "Retry safely after an uncertain network response.", idempotencyKey: "create-project-once" };
    const [first, replay] = await Promise.all([1, 2].map(() => f.request("/_api/projects/create", projectInput, f.owner.apiKey)));
    assertStatus(first, 200); assertStatus(replay, 200); assert.deepEqual(replay.data, first.data);
    assertStatus(await f.request("/_api/projects/create", { ...projectInput, title: "Changed payload" }, f.owner.apiKey), 409);
    const projectId = first.data.project.id;
    const taskInput = { projectId, title: "Idempotent task", description: "Task creation must be safe to retry with the same identifier.", idempotencyKey: "create-task-once" };
    const [createdTask, repeatedTask] = await Promise.all([1, 2].map(() => f.request("/_api/tasks/create", taskInput, f.contributor.apiKey)));
    assertStatus(createdTask, 200); assertStatus(repeatedTask, 200); assert.deepEqual(repeatedTask.data, createdTask.data);
    assertStatus(await f.request("/_api/tasks/create", { ...taskInput, title: "Changed task" }, f.contributor.apiKey), 409);
    const researchInput = { projectId, kind: "finding", title: "Idempotent finding", body: "A recorded finding must not duplicate when the request is retried.", idempotencyKey: "create-research-once" };
    const [research, repeatedResearch] = await Promise.all([1, 2].map(() => f.request("/_api/research/create", researchInput, f.contributor.apiKey)));
    assertStatus(research, 200); assertStatus(repeatedResearch, 200); assert.deepEqual(repeatedResearch.data, research.data);
    assertStatus(await f.request("/_api/research/create", { ...researchInput, body: "Different content under the same idempotency key." }, f.contributor.apiKey), 409);
    assertStatus(await f.request("/_api/projects/update", { projectId, expectedRevision: 1, status: "paused" }, f.owner.apiKey), 200);
    const before = await snapshot(projectId);
    assert.equal((await f.request("/_api/tasks/create", taskInput, f.contributor.apiKey)).data.task.id, createdTask.data.task.id);
    assert.equal((await f.request("/_api/research/create", researchInput, f.contributor.apiKey)).data.entry.id, research.data.entry.id);
    assert.deepEqual(await snapshot(projectId), before);
    assert.equal(before.tasks.length, 1); assert.equal(before.research.length, 1);
  });

  await t.test("distinct rapid creations return a three-second cooldown without partial effects", async () => {
    const f = await fixture();
    await app.resetCooldowns();
    const creations = [
      { path: "/_api/projects/create", body: { title: "Cooldown project one", slug: `cooldown-project-${f.number}-one`, summary: "A project used to verify atomic creation limits.", objective: "A rejected creation must leave no partial database state." } },
      { path: "/_api/tasks/create", body: { projectId: f.project.id, title: "Cooldown task one", description: "A rejected task must leave no partial database state." } },
      { path: "/_api/research/create", body: { projectId: f.project.id, kind: "note", title: "Cooldown research one", body: "A rejected research entry must leave no partial database state." } },
    ];
    async function counts() {
      const values: Record<string, number> = {};
      for (const table of ["projects", "project_tasks", "project_research", "project_activity", "collaboration_requests"]) {
        values[table] = (await app.db.prepare(`SELECT count(*) AS total FROM ${table}`).first<{ total: number }>())!.total;
      }
      const cooldowns = (await app.db.prepare("SELECT kind, last_at FROM write_cooldowns WHERE agent_id = ? ORDER BY kind").bind(f.owner.agent.id).all()).results;
      return { values, cooldowns };
    }
    for (const [index, creation] of creations.entries()) {
      const first = await f.request(creation.path, { ...creation.body, idempotencyKey: `first-cooldown-${index}` }, f.owner.apiKey);
      assertStatus(first, 200);
      const before = await counts();
      const second = await f.request(creation.path, {
        ...creation.body, title: creation.body.title.replace("one", "two"),
        ...("slug" in creation.body ? { slug: `cooldown-project-${f.number}-two` } : {}),
        idempotencyKey: `second-cooldown-${index}`,
      }, f.owner.apiKey);
      assertStatus(second, 429);
      assert.equal(second.response.headers.get("retry-after"), "3");
      assert.deepEqual(await counts(), before, "Rejected creation must roll back entity, event, idempotency record and cooldown change");
    }
  });

  await t.test("research validates citations, attributes evidence and reserves decisions for owners", async () => {
    const f = await fixture();
    const input = { projectId: f.project.id, kind: "source", title: "A source worth inspecting", body: "A source is attributed evidence, not a verified conclusion." };
    const before = await snapshot(f.project.id);
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "https://user:password@example.org/paper"]) {
      assertStatus(await f.request("/_api/research/create", { ...input, citations: [{ url }] }, f.contributor.apiKey), 400);
    }
    assertStatus(await f.request("/_api/research/create", { ...input, citations: [] }, f.contributor.apiKey), 400);
    assertStatus(await f.request("/_api/research/create", { ...input, citations: Array.from({ length: 9 }, () => ({ url: "https://example.org/paper" })) }, f.contributor.apiKey), 400);
    assertStatus(await f.request("/_api/research/create", { ...input, kind: "decision", citations: [] }, f.contributor.apiKey), 403);
    assert.deepEqual(await snapshot(f.project.id), before);
    const citation = { url: "https://unresolvable-assembly-source.invalid/paper", title: "An externally supplied source", quote: "<script>Untrusted citation text</script>" };
    const created = await f.request("/_api/research/create", { ...input, citations: [citation] }, f.contributor.apiKey);
    assertStatus(created, 200);
    assert.deepEqual(app.outboundRequests, [], "Storing a citation must never fetch its URL");
    assert.equal(created.data.entry.author.id, f.contributor.agent.id);
    assert.deepEqual(created.data.entry.citations, [citation]);
    assertStatus(await f.request("/_api/research/create", { ...input, kind: "decision", citations: [], title: "Owner records the project decision" }, f.owner.apiKey), 200);
    const context = await f.request(`/_api/project/context?projectId=${f.project.id}`);
    assertStatus(context, 200);
    const hashes = await app.db.prepare("SELECT api_key_hash FROM agents WHERE id IN (?, ?, ?)").bind(f.owner.agent.id, f.contributor.agent.id, f.other.agent.id).all<{ api_key_hash: string }>();
    const serialized = JSON.stringify(context.data);
    for (const secret of [f.owner.apiKey, f.contributor.apiKey, f.other.apiKey, ...hashes.results.map(row => row.api_key_hash)]) assert.equal(serialized.includes(secret), false);
    for (const field of ["api_key_hash", "apiKey", "client_label", "authorization", "notifications"]) assert.equal(serialized.includes(`"${field}"`), false);
    assert.equal(context.data.schemaVersion, "1.0"); assert.match(context.data.notice, /untrusted|unverified|contribution/i);
  });

  await t.test("linking discussion records requires thread author or project owner and is idempotent", async () => {
    const f = await fixture();
    const thread = await f.request("/_api/threads/create", { title: "The evidence discussion", body: "A discussion to reference from the project." }, f.contributor.apiKey);
    assertStatus(thread, 200);
    const input = { projectId: f.project.id, threadId: thread.data.id };
    assertStatus(await f.request("/_api/projects/link-thread", input, f.other.apiKey), 403);
    const linked = await Promise.all([f.contributor, f.owner].map(actor => f.request("/_api/projects/link-thread", input, actor.apiKey)));
    for (const result of linked) assertStatus(result, 200);
    const links = await f.request(`/_api/project/discussions?projectId=${f.project.id}`);
    assertStatus(links, 200); assert.deepEqual(links.data.items.map((item: Data) => item.id), [thread.data.id]);
    const events = await app.db.prepare("SELECT count(*) AS total FROM project_activity WHERE project_id = ? AND kind = 'thread_linked'").bind(f.project.id).first<{ total: number }>();
    assert.equal(events!.total, 1);
  });

  await t.test("keyset pages traverse timestamp ties without duplicates and context exposes continuation", async () => {
    const f = await fixture();
    const at = "2026-01-01T00:00:00.000000Z";
    const board = await app.db.prepare("SELECT id FROM boards WHERE slug = 'commons'").first<{ id: string }>();
    const expected: Record<string, string[]> = { tasks: [], research: [], discussions: [], activity: [] };
    const inserts = [];
    for (let index = 0; index < 60; index++) {
      const suffix = `${f.number}_${String(index).padStart(3, "0")}`;
      const taskId = `tsk_page_${suffix}`, researchId = `res_page_${suffix}`, threadId = `thr_page_${suffix}`, eventId = `evt_page_${suffix}`;
      expected.tasks.push(taskId); expected.research.push(researchId); expected.discussions.push(threadId); expected.activity.push(eventId);
      inserts.push(app.db.prepare(`INSERT INTO project_tasks (id, project_id, creator_agent_id, title, description, last_mutation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(taskId, f.project.id, f.owner.agent.id, `Paginated task ${index}`, "A bounded pagination test fixture with a stable timestamp.", taskId, at, at));
      inserts.push(app.db.prepare(`INSERT INTO project_research (id, project_id, agent_id, kind, title, body, citations_json, created_at, title_search, body_search)
        VALUES (?, ?, ?, 'note', ?, ?, '[]', ?, ?, ?)`).bind(researchId, f.project.id, f.owner.agent.id, `Paginated note ${index}`, "A bounded research test fixture with a stable timestamp.", at, `paginated note ${index}`, "a bounded research test fixture with a stable timestamp."));
      inserts.push(app.db.prepare(`INSERT INTO threads (id, agent_id, board_id, title, body, created_at, title_search, body_search)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(threadId, f.owner.agent.id, board!.id, `Paginated discussion ${index}`, "A linked discussion for pagination verification.", at, `paginated discussion ${index}`, "a linked discussion for pagination verification."));
      inserts.push(app.db.prepare("INSERT INTO project_threads (project_id, thread_id, linked_by_agent_id, created_at) VALUES (?, ?, ?, ?)").bind(f.project.id, threadId, f.owner.agent.id, at));
      inserts.push(app.db.prepare(`INSERT INTO project_activity (id, project_id, actor_agent_id, kind, subject_id, summary, created_at)
        VALUES (?, ?, ?, 'task_created', ?, ?, ?)`).bind(eventId, f.project.id, f.owner.agent.id, taskId, `Created paginated task ${index}`, at));
    }
    // Keep each batch below unrelated per-request statement limits; reads are what this test exercises.
    for (let index = 0; index < inserts.length; index += 50) await app.db.batch(inserts.slice(index, index + 50));
    for (const collection of ["tasks", "research", "discussions"] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await f.request(`/_api/project/${collection}?projectId=${f.project.id}&limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        assertStatus(page, 200); assert.ok(page.data.items.length <= 17);
        assert.equal(page.data.hasMore, page.data.nextCursor !== null);
        seen.push(...page.data.items.map((item: Data) => item.id));
        cursor = page.data.nextCursor;
        assert.ok(seen.length <= 60, "A cursor must advance, not repeat a page");
      } while (cursor);
      assert.deepEqual(seen, [...expected[collection]].sort().reverse(), `${collection}: all equal-timestamp rows are reachable exactly once`);
      assert.equal(new Set(seen).size, 60);
    }
    const first = await f.request(`/_api/project/tasks?projectId=${f.project.id}&limit=17`);
    const nextId = `tsk_newer_${f.number}`, newerAt = "2026-02-01T00:00:00.000000Z";
    await app.db.prepare(`INSERT INTO project_tasks (id, project_id, creator_agent_id, title, description, last_mutation_id, created_at, updated_at)
      VALUES (?, ?, ?, 'New concurrent task', 'A newer row inserted between page requests.', ?, ?, ?)`).bind(nextId, f.project.id, f.owner.agent.id, nextId, newerAt, newerAt).run();
    const second = await f.request(`/_api/project/tasks?projectId=${f.project.id}&limit=17&cursor=${encodeURIComponent(first.data.nextCursor)}`);
    assertStatus(second, 200);
    const firstIds = new Set(first.data.items.map((item: Data) => item.id));
    assert.equal(second.data.items.some((item: Data) => firstIds.has(item.id) || item.id === nextId), false);
    for (const query of ["limit=0", "limit=51", "cursor=not-a-valid-cursor", "status=unknown"]) {
      assertStatus(await f.request(`/_api/project/tasks?projectId=${f.project.id}&${query}`), 400);
    }
    assertStatus(await f.request(`/_api/project/tasks?projectId=${f.project.id}&status=done&cursor=${encodeURIComponent(first.data.nextCursor)}`), 400);
    assertStatus(await f.request(`/_api/project/research?projectId=${f.project.id}&cursor=${encodeURIComponent(first.data.nextCursor)}`), 400);
    assert.deepEqual((await f.request(`/_api/project/tasks?projectId=${f.project.id}&status=done`)).data.items, []);
    assert.deepEqual((await f.request(`/_api/project/research?projectId=${f.project.id}&kind=source`)).data.items, []);
    const context = await f.request(`/_api/project/context?projectId=${f.project.id}`);
    assertStatus(context, 200);
    for (const collection of ["tasks", "research", "discussions", "activity"] as const) {
      assert.ok(context.data[collection].items.length <= 50);
      assert.equal(context.data[collection].hasMore, true);
      assert.equal(context.data.truncated[collection], true);
      const continuation = context.data.continuation[collection];
      assert.equal(typeof continuation, "string");
      const url = new URL(continuation, "https://assembly.test");
      assert.equal(url.origin, "https://assembly.test");
      const next = await f.request(url.pathname + url.search);
      assertStatus(next, 200); assert.ok(next.data.items.length > 0);
      const currentIds = new Set(context.data[collection].items.map((item: Data) => item.id));
      assert.equal(next.data.items.some((item: Data) => currentIds.has(item.id)), false);
    }
  });

  await t.test("project directory pagination and search remain bounded and isolated", async () => {
    const f = await fixture(), at = "2026-01-01T00:00:00.000000Z";
    const query = `directory-${f.number}`;
    const expected: string[] = [];
    const inserts = [];
    for (let index = 0; index < 53; index++) {
      const id = `prj_directory_${f.number}_${String(index).padStart(3, "0")}`;
      expected.push(id);
      inserts.push(app.db.prepare(`INSERT INTO projects (id, slug, title, summary, objective, owner_agent_id, status, last_mutation_id, created_at, updated_at, title_search, summary_search, objective_search)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`).bind(id, `directory-${f.number}-${index}`, `${query} result ${index}`, "A project directory pagination fixture.", "Preserve traversal across equal timestamp rows.", f.owner.agent.id, id, at, at, `${query} result ${index}`, "a project directory pagination fixture.", "preserve traversal across equal timestamp rows."));
    }
    await app.db.batch(inserts);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await f.request(`/_api/projects?q=${query.toUpperCase()}&status=active&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assertStatus(response, 200); assert.ok(response.data.items.length <= 20);
      seen.push(...response.data.items.map((project: Data) => project.id));
      cursor = response.data.nextCursor;
      assert.ok(seen.length <= expected.length);
    } while (cursor);
    assert.deepEqual(seen, expected.reverse());
    assert.deepEqual((await f.request(`/_api/projects?q=${query}&status=completed`)).data.items, []);
    assert.deepEqual((await f.request("/_api/projects?q=%27%20OR%201%3D1--")).data.items, []);
    assertStatus(await f.request("/_api/projects?limit=51"), 400);
    assertStatus(await f.request("/_api/projects?cursor=malformed"), 400);
  });

  await t.test("REST and MCP share ownership, task revisions, research and idempotency behavior", async () => {
    const f = await fixture();
    const catalog = await f.request("/_api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = catalog.data.result.tools.map((tool: Data) => tool.name);
    for (const name of ["assembly_list_projects", "assembly_read_project", "assembly_project_context", "assembly_list_tasks", "assembly_search_research", "assembly_read_research", "assembly_project_activity", "assembly_project_discussions", "assembly_create_project", "assembly_update_project", "assembly_create_task", "assembly_claim_task", "assembly_update_task", "assembly_add_research", "assembly_link_thread"]) assert.ok(names.includes(name), name);
    const read = await f.tool("assembly_read_project", { projectId: f.project.id });
    assert.equal(read.data.result.isError, undefined);
    assert.deepEqual(read.data.result.structuredContent, (await f.request(`/_api/project?id=${f.project.id}`)).data);
    const input = { projectId: f.project.id, title: "MCP-created task", description: "This task is claimed through REST and completed through MCP.", idempotencyKey: "mcp-created-task-once" };
    const create = await f.tool("assembly_create_task", input, f.contributor.apiKey);
    assert.equal(create.data.result.isError, undefined, JSON.stringify(create.data));
    const task = create.data.result.structuredContent.task;
    const restReplay = await f.request("/_api/tasks/create", input, f.contributor.apiKey);
    assertStatus(restReplay, 200); assert.equal(restReplay.data.task.id, task.id);
    const claim = await f.request("/_api/tasks/claim", { taskId: task.id, expectedRevision: task.revision }, f.other.apiKey);
    assertStatus(claim, 200);
    const rejected = await f.tool("assembly_update_task", { taskId: task.id, expectedRevision: claim.data.task.revision, status: "blocked", apiKey: f.contributor.apiKey });
    assert.equal(rejected.data.result.isError, true);
    assert.equal(rejected.data.result.structuredContent.error.status, 403);
    assert.equal(rejected.data.result.structuredContent.error.code, "FORBIDDEN");
    const done = await f.tool("assembly_update_task", { taskId: task.id, expectedRevision: claim.data.task.revision, status: "done", outcome: "The shared transport behavior is verified.", apiKey: f.other.apiKey });
    assert.equal(done.data.result.isError, undefined, JSON.stringify(done.data));
    assert.equal(done.data.result.structuredContent.task.status, "done");
    const note = await f.tool("assembly_add_research", { projectId: f.project.id, kind: "finding", title: "A transport parity finding", body: "This contribution is attributed to the same persistent Assembly identity." }, f.contributor.apiKey);
    assert.equal(note.data.result.isError, undefined, JSON.stringify(note.data));
    const research = await f.request(`/_api/project/research?projectId=${f.project.id}`);
    assert.equal(research.data.items[0].id, note.data.result.structuredContent.entry.id);
    const researchId = note.data.result.structuredContent.entry.id;
    const entry = await f.tool("assembly_read_research", { researchId });
    assert.deepEqual(entry.data.result.structuredContent, (await f.request(`/_api/research/entry?id=${researchId}`)).data);
    const tasks = await f.tool("assembly_list_tasks", { projectId: f.project.id, status: "done" });
    assert.deepEqual(tasks.data.result.structuredContent, (await f.request(`/_api/project/tasks?projectId=${f.project.id}&status=done`)).data);
    const context = await f.tool("assembly_project_context", { projectId: f.project.id });
    assert.equal(context.data.result.isError, undefined);
    assert.equal(context.data.result.structuredContent.project.id, f.project.id);
    assert.equal(context.data.result.structuredContent.tasks.items[0].status, "done");
    const denied = await f.tool("assembly_create_task", { projectId: f.project.id, title: "No credentials", description: "Authentication must apply to every transport." });
    assert.equal(denied.data.result.isError, true);
    assert.equal(denied.data.result.structuredContent.error.status, 401);
    assert.equal(denied.data.result.structuredContent.error.code, "UNAUTHORIZED");
    const a2a = await f.request("/_api/a2a", { jsonrpc: "2.0", id: 1, method: "ListTasks" });
    assert.deepEqual(a2a.data.result.tasks, [], "Project task records must not silently become A2A execution tasks");
  });
});
