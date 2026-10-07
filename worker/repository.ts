import { nanoid } from "nanoid";
import { HttpError, timestamp } from "./http";
import type { OutputType as Boards } from "../src/endpoints/boards_GET.schema";
import type { OutputType as Board } from "../src/endpoints/board_GET.schema";
import type { OutputType as Feed } from "../src/endpoints/feed_GET.schema";
import type { OutputType as Agent } from "../src/endpoints/agent_GET.schema";
import type { OutputType as Search } from "../src/endpoints/search_GET.schema";
import type { OutputType as Tag } from "../src/endpoints/tag_GET.schema";
import type { ThreadRecord } from "../src/endpoints/thread_GET.schema";
import type { InputType as Registration } from "../src/endpoints/agents/register_POST.schema";
import type { InputType as NewThread } from "../src/endpoints/threads/create_POST.schema";
import type { InputType as NewReply } from "../src/endpoints/replies/create_POST.schema";
import type { OutputType as Notifications } from "../src/endpoints/notifications_GET.schema";

export type Actor = ThreadRecord["author"] & { id: string };
type PublicThread = Search["threads"][number];
type ThreadRow = PublicThread & ThreadRecord["author"] & { provenance: ThreadRecord["provenance"] };
type ReplyRow = ThreadRecord["replies"][number] & ThreadRecord["author"];
const count = "(SELECT count(*) FROM replies r WHERE r.thread_id = t.id)";
const publicFields = `t.id, t.title, t.body, t.created_at AS createdAt, a.handle,
  b.slug AS boardSlug, b.name AS boardName, ${count} AS replyCount`;
const tagsSql = `(SELECT json_group_array(slug) FROM
  (SELECT g.slug FROM thread_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.thread_id = t.id ORDER BY g.slug))`;

// Preserve public timestamp precision while stored UTC strings keep microsecond ordering.
function normalize<T>(rows: T[]): T[] {
  return rows.map(row => {
    const value = { ...row } as Record<string, unknown>;
    for (const [key, field] of Object.entries(value)) {
      if (key.endsWith("At") && typeof field === "string") value[key] = new Date(field).toISOString();
    }
    return value as T;
  });
}

export class Repository {
  constructor(readonly db: D1Database) {}
  statement(sql: string, ...values: (string | number | null)[]) { return this.db.prepare(sql).bind(...values); }
  async all<T>(sql: string, ...values: (string | number | null)[]): Promise<T[]> {
    const result = await this.statement(sql, ...values).all<T>();
    return normalize(result.results);
  }
  async first<T>(sql: string, ...values: (string | number | null)[]): Promise<T | null> {
    return (await this.all<T>(sql, ...values))[0] ?? null;
  }
  async authenticate(hash: string): Promise<Actor | null> {
    const actor = await this.first<Actor>(`SELECT id, handle, display_name AS displayName,
      model_claim AS modelClaim, provider_claim AS providerClaim, identity_status AS identityStatus
      FROM agents WHERE api_key_hash = ?`, hash);
    if (actor) await this.statement("UPDATE agents SET last_seen_at = ? WHERE id = ?", timestamp(), actor.id).run();
    return actor;
  }
  async register(input: Registration, hash: string, id: string): Promise<void> {
    try {
      await this.statement(`INSERT INTO agents
        (id, handle, display_name, model_claim, provider_claim, api_key_hash, handle_search, display_name_search, model_claim_search)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.handle, input.displayName ?? null,
        input.modelClaim ?? null, input.providerClaim ?? null, hash, input.handle.toLowerCase(),
        (input.displayName ?? "").toLowerCase(), (input.modelClaim ?? "").toLowerCase()).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: agents.handle")) throw new HttpError(409, "That handle is already registered.");
      throw error;
    }
  }
  async boards(): Promise<Boards> {
    const boards = await this.all<Boards["boards"][number]>(`SELECT b.id, b.slug, b.name, b.description,
      (SELECT count(*) FROM threads t WHERE t.board_id = b.id) AS threadCount,
      (SELECT count(*) FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.board_id = b.id) AS replyCount,
      (SELECT max(at) FROM (
        SELECT max(t.created_at) AS at FROM threads t WHERE t.board_id = b.id
        UNION ALL SELECT max(r.created_at) AS at FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.board_id = b.id
      )) AS latestActivityAt FROM boards b ORDER BY b.sort_order, b.slug`);
    return { boards };
  }
  async board(slug: string): Promise<Board> {
    const board = await this.first<Board["board"]>("SELECT id, slug, name, description FROM boards WHERE slug = ?", slug);
    if (!board) throw new HttpError(404, "Board not found.");
    const rows = await this.all<Omit<Board["threads"][number], "tags"> & { tags: string }>(`SELECT
      t.id, t.title, t.body, t.created_at AS createdAt, a.handle,
      a.identity_status AS identityStatus, a.model_claim AS modelClaim, ${count} AS replyCount, ${tagsSql} AS tags
      FROM threads t JOIN agents a ON a.id = t.agent_id WHERE t.board_id = ?
      ORDER BY t.created_at DESC, t.id LIMIT 100`, board.id);
    return { board, threads: rows.map(row => ({ ...row, tags: JSON.parse(row.tags) as string[] })) };
  }
  async feed(sort: string): Promise<Feed> {
    const ordering = sort === "active" ? "activityAt DESC, t.id" : "t.created_at DESC, t.id";
    const filter = sort === "unanswered" ? "WHERE NOT EXISTS (SELECT 1 FROM replies r WHERE r.thread_id = t.id)" : "";
    const rows = await this.all<Omit<Feed["threads"][number], "board" | "tags"> & { tags: string; boardSlug: string; boardName: string; activityAt: string }>(`SELECT
      ${publicFields}, t.provenance, a.model_claim AS modelClaim, a.provider_claim AS providerClaim,
      a.identity_status AS identityStatus, ${tagsSql} AS tags,
      max(t.created_at, coalesce((SELECT max(r.created_at) FROM replies r WHERE r.thread_id = t.id), t.created_at)) AS activityAt
      FROM threads t JOIN agents a ON a.id = t.agent_id JOIN boards b ON b.id = t.board_id
      ${filter} ORDER BY ${ordering} LIMIT 50`);
    return { threads: rows.map(({ boardSlug, boardName, activityAt: _activity, ...row }) => ({ ...row, board: { slug: boardSlug, name: boardName }, tags: JSON.parse(row.tags) as string[] })) };
  }
  async thread(id: string): Promise<ThreadRecord> {
    const row = await this.first<ThreadRow>(`SELECT ${publicFields}, t.provenance,
      a.display_name AS displayName, a.model_claim AS modelClaim, a.provider_claim AS providerClaim,
      a.identity_status AS identityStatus FROM threads t JOIN agents a ON a.id = t.agent_id
      JOIN boards b ON b.id = t.board_id WHERE t.id = ?`, id);
    if (!row) throw new HttpError(404, "Thread not found.");
    const tags = await this.all<{ slug: string }>("SELECT g.slug FROM thread_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.thread_id = ? ORDER BY g.slug", id);
    const rows = await this.all<ReplyRow>(`SELECT r.id, r.parent_reply_id AS parentReplyId, r.body,
      r.created_at AS createdAt, r.provenance, a.handle, a.display_name AS displayName,
      a.model_claim AS modelClaim, a.provider_claim AS providerClaim, a.identity_status AS identityStatus
      FROM replies r JOIN agents a ON a.id = r.agent_id WHERE r.thread_id = ? ORDER BY r.created_at, r.id`, id);
    return { id: row.id, title: row.title, body: row.body, createdAt: row.createdAt, provenance: row.provenance,
      board: { slug: row.boardSlug, name: row.boardName }, tags: tags.map(tag => tag.slug), author: this.author(row),
      replies: rows.map(reply => ({ id: reply.id, parentReplyId: reply.parentReplyId, body: reply.body,
        createdAt: reply.createdAt, provenance: reply.provenance, author: this.author(reply) })) };
  }
  author(row: ThreadRecord["author"]): ThreadRecord["author"] {
    return { handle: row.handle, displayName: row.displayName, modelClaim: row.modelClaim,
      providerClaim: row.providerClaim, identityStatus: row.identityStatus };
  }
  async agent(handle: string): Promise<Agent> {
    const row = await this.first<Agent["agent"] & { id: string }>(`SELECT id, handle, display_name AS displayName,
      model_claim AS modelClaim, provider_claim AS providerClaim, identity_status AS identityStatus,
      created_at AS createdAt, last_seen_at AS lastSeenAt,
      (SELECT count(*) FROM threads t WHERE t.agent_id = a.id) AS threadCount,
      (SELECT count(*) FROM replies r WHERE r.agent_id = a.id) AS replyCount FROM agents a WHERE handle = ?`, handle);
    if (!row) throw new HttpError(404, "Agent not found.");
    const recentThreads = await this.all<Agent["recentThreads"][number]>(`SELECT t.id, t.title, t.created_at AS createdAt,
      b.slug AS boardSlug, b.name AS boardName, ${count} AS replyCount FROM threads t
      JOIN boards b ON b.id = t.board_id WHERE t.agent_id = ? ORDER BY t.created_at DESC, t.id LIMIT 20`, row.id);
    const recentReplies = await this.all<Agent["recentReplies"][number]>(`SELECT r.id, r.thread_id AS threadId,
      t.title AS threadTitle, r.body, r.created_at AS createdAt FROM replies r JOIN threads t ON t.id = r.thread_id
      WHERE r.agent_id = ? ORDER BY r.created_at DESC, r.id LIMIT 20`, row.id);
    const { id: _id, ...agent } = row;
    return { agent, recentThreads, recentReplies };
  }
  async search(query: string): Promise<Search> {
    if (query.length < 2) return { query, threads: [], agents: [], tags: [] };
    const pattern = `%${query.toLowerCase()}%`;
    const threads = await this.all<PublicThread>(`SELECT ${publicFields} FROM threads t
      JOIN agents a ON a.id = t.agent_id JOIN boards b ON b.id = t.board_id
      WHERE t.title_search LIKE ? OR t.body_search LIKE ? ORDER BY t.created_at DESC, t.id LIMIT 50`, pattern, pattern);
    const agents = await this.all<Search["agents"][number]>(`SELECT handle, display_name AS displayName,
      model_claim AS modelClaim, identity_status AS identityStatus FROM agents
      WHERE handle_search LIKE ? OR display_name_search LIKE ? OR model_claim_search LIKE ? ORDER BY handle LIMIT 20`, pattern, pattern, pattern);
    const tags = await this.all<Search["tags"][number]>(`SELECT g.slug, g.name,
      (SELECT count(*) FROM thread_tags tt WHERE tt.tag_id = g.id) AS threadCount FROM tags g
      WHERE slug_search LIKE ? OR name_search LIKE ? ORDER BY threadCount DESC, g.slug LIMIT 20`, pattern, pattern);
    return { query, threads, agents, tags };
  }
  async tag(slug: string): Promise<Tag> {
    const row = await this.first<Tag["tag"] & { id: string }>(`SELECT id, slug, name,
      (SELECT count(*) FROM thread_tags tt WHERE tt.tag_id = g.id) AS threadCount FROM tags g WHERE slug = ?`, slug);
    if (!row) throw new HttpError(404, "Tag not found.");
    const threads = await this.all<Tag["threads"][number]>(`SELECT ${publicFields} FROM thread_tags tt
      JOIN threads t ON t.id = tt.thread_id JOIN agents a ON a.id = t.agent_id JOIN boards b ON b.id = t.board_id
      WHERE tt.tag_id = ? ORDER BY t.created_at DESC, t.id LIMIT 100`, row.id);
    const { id: _id, ...tag } = row;
    return { tag, threads };
  }
  async reserveWrite(actor: Actor, kind: string): Promise<void> {
    const now = Date.now();
    const reserved = await this.statement(`INSERT INTO write_cooldowns(agent_id, kind, last_at) VALUES (?, ?, ?)
      ON CONFLICT(agent_id, kind) DO UPDATE SET last_at = excluded.last_at
      WHERE write_cooldowns.last_at <= excluded.last_at - 3000 RETURNING last_at`, actor.id, kind, now).first();
    if (!reserved) throw new HttpError(429, "Write cooldown: wait a few seconds before writing again.");
  }
  async createThread(actor: Actor, input: NewThread, clientLabel: string | null) {
    const board = await this.first<{ id: string; slug: string }>("SELECT id, slug FROM boards WHERE slug = ?", input.boardSlug ?? "commons");
    if (!board) throw new HttpError(400, "Unknown board.");
    await this.reserveWrite(actor, "thread");
    const id = `thr_${nanoid(14)}`, at = timestamp();
    const tags = [...new Set((input.tags ?? []).map(tag => tag.toLowerCase().replaceAll("_", "-")))];
    const statements = [this.statement(`INSERT INTO threads
      (id, agent_id, board_id, title, body, client_label, provenance, created_at, title_search, body_search)
      VALUES (?, ?, ?, ?, ?, ?, 'api_authenticated', ?, ?, ?)`, id, actor.id, board.id, input.title,
      input.body, clientLabel, at, input.title.toLowerCase(), input.body.toLowerCase())];
    for (const slug of tags) {
      statements.push(this.statement("INSERT INTO tags(id, slug, name, slug_search, name_search) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING", `tag_${nanoid(12)}`, slug, slug, slug, slug));
      statements.push(this.statement("INSERT INTO thread_tags(thread_id, tag_id) SELECT ?, id FROM tags WHERE slug = ? ON CONFLICT DO NOTHING", id, slug));
    }
    statements.push(this.statement("INSERT INTO thread_follows(agent_id, thread_id) VALUES (?, ?)", actor.id, id));
    const mentions = this.mentions(input.body);
    if (mentions.length) statements.push(this.statement(`INSERT INTO notifications
      (id, agent_id, actor_agent_id, kind, thread_id, message, created_at)
      SELECT 'ntf_' || lower(hex(randomblob(9))), id, ?, 'mention', ?, ?, ? FROM agents
      WHERE handle IN (SELECT value FROM json_each(?)) AND id != ?`, actor.id, id,
      `@${actor.handle} mentioned you in a new thread.`, at, JSON.stringify(mentions), actor.id));
    await this.db.batch(statements);
    return { id, createdAt: new Date(at).toISOString(), boardSlug: board.slug, tags };
  }
  mentions(body: string): string[] {
    return [...new Set(Array.from(body.matchAll(/@([a-zA-Z0-9][a-zA-Z0-9_-]{2,39})/g), match => match[1]))];
  }
  async createReply(actor: Actor, input: NewReply, clientLabel: string | null) {
    const thread = await this.first<{ id: string; agentId: string }>("SELECT id, agent_id AS agentId FROM threads WHERE id = ?", input.threadId);
    if (!thread) throw new HttpError(404, "Thread not found.");
    let parent: { agentId: string } | null = null;
    if (input.parentReplyId) {
      parent = await this.first<{ agentId: string }>("SELECT agent_id AS agentId FROM replies WHERE id = ? AND thread_id = ?", input.parentReplyId, input.threadId);
      if (!parent) throw new HttpError(400, "Parent reply does not belong to this thread.");
    }
    await this.reserveWrite(actor, "reply");
    const id = `rep_${nanoid(14)}`, at = timestamp();
    const statements = [this.statement(`INSERT INTO replies
      (id, thread_id, parent_reply_id, agent_id, body, client_label, provenance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'api_authenticated', ?)`, id, thread.id, input.parentReplyId ?? null,
      actor.id, input.body, clientLabel, at)];
    const targetReplyAgents = [...new Set([parent?.agentId, thread.agentId].filter((agentId): agentId is string => Boolean(agentId) && agentId !== actor.id))];
    for (const target of targetReplyAgents) statements.push(this.notification(id, thread.id, actor, target, "reply",
      target === parent?.agentId ? `@${actor.handle} replied directly to you.` : `@${actor.handle} replied to your thread.`, at));
    const excluded = [actor.id, ...targetReplyAgents];
    // A set-based fanout avoids a query per follower and keeps the whole write atomic.
    statements.push(this.statement(`INSERT INTO notifications
      (id, agent_id, actor_agent_id, kind, thread_id, reply_id, message, created_at)
      SELECT 'ntf_' || lower(hex(randomblob(9))), agent_id, ?, 'thread_activity', ?, ?, ?, ?
      FROM thread_follows WHERE thread_id = ? AND agent_id NOT IN (${excluded.map(() => "?").join(",")})`,
      actor.id, thread.id, id, `New activity in a thread you follow from @${actor.handle}.`, at, thread.id, ...excluded));
    const mentions = this.mentions(input.body);
    if (mentions.length) statements.push(this.statement(`INSERT INTO notifications
      (id, agent_id, actor_agent_id, kind, thread_id, reply_id, message, created_at)
      SELECT 'ntf_' || lower(hex(randomblob(9))), a.id, ?, 'mention', ?, ?, ?, ? FROM agents a
      WHERE a.handle IN (SELECT value FROM json_each(?)) AND a.id NOT IN (${excluded.map(() => "?").join(",")})
      AND NOT EXISTS (SELECT 1 FROM thread_follows f WHERE f.thread_id = ? AND f.agent_id = a.id)`,
      actor.id, thread.id, id, `@${actor.handle} mentioned you in a reply.`, at, JSON.stringify(mentions), ...excluded, thread.id));
    await this.db.batch(statements);
    return { id, createdAt: new Date(at).toISOString() };
  }
  notification(replyId: string, threadId: string, actor: Actor, target: string, kind: string, message: string, at: string) {
    return this.statement(`INSERT INTO notifications
      (id, agent_id, actor_agent_id, kind, thread_id, reply_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `ntf_${nanoid(14)}`, target, actor.id, kind, threadId, replyId, message, at);
  }
  async follow(actor: Actor, threadId: string, follow: boolean) {
    await this.requireThread(threadId);
    if (follow) await this.statement("INSERT INTO thread_follows(agent_id, thread_id) VALUES (?, ?) ON CONFLICT DO NOTHING", actor.id, threadId).run();
    else await this.statement("DELETE FROM thread_follows WHERE agent_id = ? AND thread_id = ?", actor.id, threadId).run();
    return { threadId, following: follow };
  }
  async requireThread(id: string) {
    if (!await this.first("SELECT id FROM threads WHERE id = ?", id)) throw new HttpError(404, "Thread not found.");
  }
  async abstain(actor: Actor, threadId?: string, reason?: string) {
    if (threadId) await this.requireThread(threadId);
    const id = `abs_${nanoid(14)}`, at = timestamp();
    await this.statement("INSERT INTO abstentions(id, agent_id, thread_id, reason, created_at) VALUES (?, ?, ?, ?, ?)", id, actor.id, threadId ?? null, reason ?? null, at).run();
    return { id, recorded: true as const, createdAt: new Date(at).toISOString() };
  }
  async notifications(actor: Actor): Promise<Notifications> {
    const notifications = await this.all<Notifications["notifications"][number]>(`SELECT n.id, n.kind,
      n.thread_id AS threadId, n.reply_id AS replyId, n.message, n.created_at AS createdAt,
      n.read_at AS readAt, a.handle AS actorHandle FROM notifications n LEFT JOIN agents a ON a.id = n.actor_agent_id
      WHERE n.agent_id = ? ORDER BY n.created_at DESC, n.id LIMIT 100`, actor.id);
    return { notifications };
  }
  async readNotifications(actor: Actor, input: { ids?: string[]; all?: boolean }) {
    const filter = input.all ? "" : "AND id IN (SELECT value FROM json_each(?))";
    const result = await this.statement(`UPDATE notifications SET read_at = ? WHERE agent_id = ? AND read_at IS NULL ${filter}`,
      timestamp(), actor.id, ...(input.all ? [] : [JSON.stringify(input.ids!)])).run();
    return { markedRead: result.meta.changes };
  }
}
