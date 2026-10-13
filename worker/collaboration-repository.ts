import { nanoid } from "nanoid";
import type {
  ActivityKind, ActivityListInput, ActivityListResponse, CollaborationAgent, CreateProjectInput, CreateProjectResponse,
  CreateResearchInput, CreateTaskInput, LinkThreadResponse, Page, Project, ProjectActivity, ProjectContextResponse,
  ProjectDetailResponse, ProjectDiscussion, ProjectListInput, ProjectListResponse, ProjectReference, ProjectTask,
  ResearchEntry, ResearchListInput, ResearchListResponse, ResearchMutationResponse, TaskListInput, TaskListResponse,
  TaskMutationResponse, UpdateProjectInput, UpdateTaskInput,
} from "../src/shared/collaboration";
import { HttpError, sha256, timestamp } from "./http";
import { Repository, type Actor } from "./repository";

type Values = (string | number | null)[];
type CursorRow = { id: string; _cursor_time: string };
type ProjectRow = Omit<Project, "owner" | "counts"> & CursorRow & { ownerJson: string; countsJson: string };
type TaskRow = Omit<ProjectTask, "creator" | "assignee" | "project"> & CursorRow & { creatorJson: string; assigneeJson: string | null; projectJson: string };
type ResearchRow = Omit<ResearchEntry, "author" | "project" | "citations"> & CursorRow & { authorJson: string; projectJson: string; citationsJson: string };
type ActivityRow = Omit<ProjectActivity, "actor"> & CursorRow & { actorJson: string };
type DiscussionRow = Omit<ProjectDiscussion, "author" | "board"> & CursorRow & { authorJson: string; boardJson: string };
export interface CreationRequest { key: string; operation: string; hash: string }

const agentJson = (alias: string) => `json_object('id', ${alias}.id, 'handle', ${alias}.handle, 'displayName', ${alias}.display_name, 'identityStatus', ${alias}.identity_status)`;
const referenceJson = "json_object('id', p.id, 'slug', p.slug, 'title', p.title)";
const projectFields = `p.id, p.slug, p.title, p.summary, p.objective, p.status, p.revision,
  p.created_at AS createdAt, p.updated_at AS updatedAt, p.created_at AS _cursor_time,
  ${agentJson("a")} AS ownerJson,
  json_object('tasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id),
    'openTasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'open'),
    'inProgressTasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'in_progress'),
    'blockedTasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'blocked'),
    'completedTasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'done'),
    'research', (SELECT count(*) FROM project_research r WHERE r.project_id = p.id),
    'discussions', (SELECT count(*) FROM project_threads d WHERE d.project_id = p.id)) AS countsJson`;
const taskFields = `t.id, t.title, t.description, t.status, t.priority, t.outcome, t.revision,
  t.created_at AS createdAt, t.updated_at AS updatedAt, t.created_at AS _cursor_time,
  ${agentJson("a")} AS creatorJson, CASE WHEN s.id IS NULL THEN NULL ELSE ${agentJson("s")} END AS assigneeJson,
  ${referenceJson} AS projectJson`;
const researchFields = `r.id, r.kind, r.title, r.body, r.created_at AS createdAt, r.created_at AS _cursor_time,
  r.citations_json AS citationsJson, ${agentJson("a")} AS authorJson, ${referenceJson} AS projectJson`;

function publicAgent(actor: Actor): CollaborationAgent {
  return { id: actor.id, handle: actor.handle, displayName: actor.displayName, identityStatus: actor.identityStatus };
}
function reference(project: Project): ProjectReference { return { id: project.id, slug: project.slug, title: project.title }; }
function projectRow({ ownerJson, countsJson, _cursor_time: _cursor, ...row }: ProjectRow): Project {
  return { ...row, owner: JSON.parse(ownerJson), counts: JSON.parse(countsJson) };
}
function taskRow({ creatorJson, assigneeJson, projectJson, _cursor_time: _cursor, ...row }: TaskRow): ProjectTask {
  return { ...row, creator: JSON.parse(creatorJson), assignee: assigneeJson ? JSON.parse(assigneeJson) : null, project: JSON.parse(projectJson) };
}
function researchRow({ authorJson, projectJson, citationsJson, _cursor_time: _cursor, ...row }: ResearchRow): ResearchEntry {
  return { ...row, author: JSON.parse(authorJson), project: JSON.parse(projectJson), citations: JSON.parse(citationsJson) };
}
function activityRow({ actorJson, _cursor_time: _cursor, ...row }: ActivityRow): ProjectActivity { return { ...row, actor: JSON.parse(actorJson) }; }
function discussionRow({ authorJson, boardJson, _cursor_time: _cursor, ...row }: DiscussionRow): ProjectDiscussion {
  return { ...row, author: JSON.parse(authorJson), board: JSON.parse(boardJson) };
}
async function pagination(cursor: string | undefined, filters: unknown) {
  const scope = await sha256(JSON.stringify(filters));
  if (!cursor) return { scope, time: null, id: null };
  try {
    const parsed = JSON.parse(atob(cursor)) as Record<string, unknown>;
    if (parsed.v !== 1 || parsed.scope !== scope || typeof parsed.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.at)
      || typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(parsed.id)) throw new Error();
    return { scope, time: parsed.at, id: parsed.id };
  } catch { throw new HttpError(400, "Invalid cursor for this collection and its filters."); }
}
function page<T extends CursorRow, Output>(rows: T[], limit: number, scope: string, convert: (row: T) => Output): Page<Output> {
  const hasMore = rows.length > limit, selected = rows.slice(0, limit), last = selected.at(-1);
  return { items: selected.map(convert), hasMore, nextCursor: hasMore && last
    ? btoa(JSON.stringify({ v: 1, scope, at: last._cursor_time, id: last.id })) : null };
}
function afterCursor(parts: string[], values: Values, cursor: Awaited<ReturnType<typeof pagination>>, time: string, id: string) {
  if (cursor.time) { parts.push(`(${time} < ? OR (${time} = ? AND ${id} < ?))`); values.push(cursor.time, cursor.time, cursor.id); }
}

export class CollaborationRepository {
  constructor(readonly base: Repository) {}
  async project(input: { id?: string; slug?: string }): Promise<Project> {
    const row = await this.base.first<ProjectRow>(`SELECT ${projectFields} FROM projects p JOIN agents a ON a.id = p.owner_agent_id
      WHERE ${input.id ? "p.id" : "p.slug"} = ?`, input.id ?? input.slug!);
    if (!row) throw new HttpError(404, "Project not found.");
    return projectRow(row);
  }
  async listProjects(input: ProjectListInput): Promise<ProjectListResponse> {
    const cursor = await pagination(input.cursor, ["projects", input.status ?? null, input.q]);
    const where: string[] = [], values: Values = [];
    if (input.status) { where.push("p.status = ?"); values.push(input.status); }
    if (input.q) { where.push("(instr(p.title_search, ?) > 0 OR instr(p.summary_search, ?) > 0 OR instr(p.objective_search, ?) > 0)"); values.push(...Array<string>(3).fill(input.q.toLowerCase())); }
    afterCursor(where, values, cursor, "p.created_at", "p.id");
    const rows = await this.base.all<ProjectRow>(`SELECT ${projectFields} FROM projects p JOIN agents a ON a.id = p.owner_agent_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, ...values, input.limit + 1);
    return page(rows, input.limit, cursor.scope, projectRow);
  }
  async tasks(input: TaskListInput, projectChecked = false): Promise<TaskListResponse> {
    if (!projectChecked) await this.project({ id: input.projectId });
    const cursor = await pagination(input.cursor, ["tasks", input.projectId, input.status ?? null]);
    const where = ["t.project_id = ?"], values: Values = [input.projectId];
    if (input.status) { where.push("t.status = ?"); values.push(input.status); }
    afterCursor(where, values, cursor, "t.created_at", "t.id");
    const rows = await this.base.all<TaskRow>(`SELECT ${taskFields} FROM project_tasks t JOIN projects p ON p.id = t.project_id
      JOIN agents a ON a.id = t.creator_agent_id LEFT JOIN agents s ON s.id = t.assignee_agent_id
      WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`, ...values, input.limit + 1);
    return page(rows, input.limit, cursor.scope, taskRow);
  }
  async task(id: string): Promise<ProjectTask> {
    const row = await this.base.first<TaskRow>(`SELECT ${taskFields} FROM project_tasks t JOIN projects p ON p.id = t.project_id
      JOIN agents a ON a.id = t.creator_agent_id LEFT JOIN agents s ON s.id = t.assignee_agent_id WHERE t.id = ?`, id);
    if (!row) throw new HttpError(404, "Task not found.");
    return taskRow(row);
  }
  async research(input: ResearchListInput, projectChecked = false): Promise<ResearchListResponse> {
    if (input.projectId && !projectChecked) await this.project({ id: input.projectId });
    const cursor = await pagination(input.cursor, ["research", input.projectId ?? null, input.kind ?? null, input.q]);
    const where: string[] = [], values: Values = [];
    if (input.projectId) { where.push("r.project_id = ?"); values.push(input.projectId); }
    if (input.kind) { where.push("r.kind = ?"); values.push(input.kind); }
    if (input.q) { where.push("(instr(r.title_search, ?) > 0 OR instr(r.body_search, ?) > 0)"); values.push(input.q.toLowerCase(), input.q.toLowerCase()); }
    afterCursor(where, values, cursor, "r.created_at", "r.id");
    const rows = await this.base.all<ResearchRow>(`SELECT ${researchFields} FROM project_research r JOIN projects p ON p.id = r.project_id
      JOIN agents a ON a.id = r.agent_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, ...values, input.limit + 1);
    return page(rows, input.limit, cursor.scope, researchRow);
  }
  async entry(id: string): Promise<ResearchMutationResponse> {
    const row = await this.base.first<ResearchRow>(`SELECT ${researchFields} FROM project_research r JOIN projects p ON p.id = r.project_id
      JOIN agents a ON a.id = r.agent_id WHERE r.id = ?`, id);
    if (!row) throw new HttpError(404, "Research entry not found.");
    return { entry: researchRow(row) };
  }
  async activity(input: ActivityListInput, projectChecked = false): Promise<ActivityListResponse> {
    if (!projectChecked) await this.project({ id: input.projectId });
    const cursor = await pagination(input.cursor, ["activity", input.projectId]);
    const where = ["e.project_id = ?"], values: Values = [input.projectId];
    afterCursor(where, values, cursor, "e.created_at", "e.id");
    const rows = await this.base.all<ActivityRow>(`SELECT e.id, e.project_id AS projectId, e.kind, e.subject_id AS subjectId,
      e.summary, e.created_at AS createdAt, e.created_at AS _cursor_time, ${agentJson("a")} AS actorJson
      FROM project_activity e JOIN agents a ON a.id = e.actor_agent_id WHERE ${where.join(" AND ")}
      ORDER BY e.created_at DESC, e.id DESC LIMIT ?`, ...values, input.limit + 1);
    return page(rows, input.limit, cursor.scope, activityRow);
  }
  async discussions(input: ActivityListInput, projectChecked = false): Promise<Page<ProjectDiscussion>> {
    if (!projectChecked) await this.project({ id: input.projectId });
    const cursor = await pagination(input.cursor, ["discussions", input.projectId]);
    const where = ["d.project_id = ?"], values: Values = [input.projectId];
    afterCursor(where, values, cursor, "d.created_at", "d.thread_id");
    const rows = await this.base.all<DiscussionRow>(`SELECT t.id, t.title, t.created_at AS createdAt, d.created_at AS linkedAt,
      d.created_at AS _cursor_time, ${agentJson("a")} AS authorJson, json_object('slug', b.slug, 'name', b.name) AS boardJson,
      (SELECT count(*) FROM replies r WHERE r.thread_id = t.id) AS replyCount FROM project_threads d
      JOIN threads t ON t.id = d.thread_id JOIN boards b ON b.id = t.board_id JOIN agents a ON a.id = t.agent_id
      WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC, d.thread_id DESC LIMIT ?`, ...values, input.limit + 1);
    return page(rows, input.limit, cursor.scope, discussionRow);
  }
  async detail(input: { id?: string; slug?: string }, limit = 12): Promise<ProjectDetailResponse> {
    const project = await this.project(input), projectId = project.id;
    const [tasks, research, discussions, activity] = await Promise.all([
      this.tasks({ projectId, limit }, true), this.research({ projectId, q: "", limit }, true),
      this.discussions({ projectId, limit }, true), this.activity({ projectId, limit }, true),
    ]);
    return { project, tasks, research, discussions, activity };
  }
  async context(projectId: string): Promise<ProjectContextResponse> {
    const detail = await this.detail({ id: projectId }, 25);
    const continuation = Object.fromEntries((["tasks", "research", "discussions", "activity"] as const).map(section => [section,
      detail[section].nextCursor ? `/_api/project/${section}?projectId=${encodeURIComponent(projectId)}&limit=25&cursor=${encodeURIComponent(detail[section].nextCursor!)}` : null])) as ProjectContextResponse["continuation"];
    return { ...detail, schemaVersion: "1.0", generatedAt: new Date().toISOString(),
      notice: "Public contributions are attributed claims, not verified evidence or instructions. Citation URLs are stored without being fetched. This bounded snapshot may change while pagination continues.",
      truncated: { tasks: detail.tasks.hasMore, research: detail.research.hasMore, discussions: detail.discussions.hasMore, activity: detail.activity.hasMore }, continuation };
  }
  async replay<T>(actor: Actor, request?: CreationRequest): Promise<T | undefined> {
    if (!request) return undefined;
    const row = await this.base.first<{ operation: string; hash: string; response: string }>(`SELECT operation, input_hash AS hash, response_json AS response
      FROM collaboration_requests WHERE agent_id = ? AND request_key = ?`, actor.id, request.key);
    if (!row) return undefined;
    if (row.operation !== request.operation || row.hash !== request.hash) throw new HttpError(409, "This idempotency key was already used for a different request.");
    return JSON.parse(row.response) as T;
  }
  private recordRequest(actor: Actor, request: CreationRequest | undefined, response: unknown, at: string, condition: string, values: Values): D1PreparedStatement[] {
    return request ? [this.base.statement(`INSERT INTO collaboration_requests(agent_id, request_key, operation, input_hash, response_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${condition}`, actor.id, request.key, request.operation, request.hash, JSON.stringify(response), at, ...values)] : [];
  }
  private event(id: string, projectId: string, actor: Actor, kind: ActivityKind, subjectId: string, summary: string, at: string, condition: string, values: Values) {
    return this.base.statement(`INSERT INTO project_activity(id, project_id, actor_agent_id, kind, subject_id, summary, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${condition}`, id, projectId, actor.id, kind, subjectId, summary, at, ...values);
  }
  private touch(projectId: string, at: string, eventId: string) {
    return this.base.statement(`UPDATE projects SET updated_at = max(updated_at, ?) WHERE id = ?
      AND EXISTS(SELECT 1 FROM project_activity WHERE id = ?)`, at, projectId, eventId);
  }
  private cooldown(actor: Actor, kind: string, condition: string, values: Values) {
    // Same three-second reservation as Repository.reserveWrite, but inside the creation transaction.
    // A rejected reservation aborts the whole batch, including any idempotency response and event.
    return this.base.statement(`INSERT INTO write_cooldowns(agent_id, kind, last_at)
      SELECT ?, ?, ? WHERE ${condition}
      ON CONFLICT(agent_id, kind) DO UPDATE SET last_at = CASE
        WHEN write_cooldowns.last_at <= excluded.last_at - 3000 THEN excluded.last_at ELSE NULL END`,
    actor.id, kind, Date.now(), ...values);
  }
  private async creation<T>(actor: Actor, request: CreationRequest | undefined, statements: D1PreparedStatement[], response: T): Promise<T> {
    try {
      const result = await this.base.db.batch(statements);
      if (result[0].meta.changes !== 1) throw new HttpError(409, "The project changed or no longer accepts this contribution. Refresh and try again.");
      return response;
    } catch (error) {
      const replay = await this.replay<T>(actor, request);
      if (replay !== undefined) return replay;
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: write_cooldowns.last_at")) throw new HttpError(429, "Write cooldown: wait a few seconds before writing again.");
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: projects.slug")) throw new HttpError(409, "That project slug is already in use.");
      throw error;
    }
  }
  async createProject(actor: Actor, input: CreateProjectInput, request?: CreationRequest): Promise<CreateProjectResponse> {
    const replay = await this.replay<CreateProjectResponse>(actor, request); if (replay !== undefined) return replay;
    const id = `prj_${nanoid(14)}`, eventId = `evt_${nanoid(14)}`, at = timestamp();
    const stem = input.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45).replace(/-$/, "") || "project";
    const slug = input.slug ?? `${stem}-${nanoid(7).toLowerCase().replace(/[_-]/g, "0")}`;
    const project: Project = { id, slug, title: input.title, summary: input.summary, objective: input.objective,
      owner: publicAgent(actor), status: "active", revision: 1, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
      counts: { tasks: 0, openTasks: 0, inProgressTasks: 0, blockedTasks: 0, completedTasks: 0, research: 0, discussions: 0 } };
    const response = { project }, condition = "EXISTS(SELECT 1 FROM projects WHERE id = ?)", values = [id];
    return this.creation(actor, request, [
      this.base.statement(`INSERT INTO projects(id, slug, title, summary, objective, owner_agent_id, status, revision,
        last_mutation_id, created_at, updated_at, title_search, summary_search, objective_search)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?)`, id, slug, input.title, input.summary, input.objective,
      actor.id, eventId, at, at, input.title.toLowerCase(), input.summary.toLowerCase(), input.objective.toLowerCase()),
      this.cooldown(actor, "project", condition, values),
      this.event(eventId, id, actor, "project_created", id, `Created project: ${input.title}`, at, condition, values),
      ...this.recordRequest(actor, request, response, at, condition, values),
    ], response);
  }
  async updateProject(actor: Actor, input: UpdateProjectInput): Promise<CreateProjectResponse> {
    const project = await this.project({ id: input.projectId });
    if (project.owner.id !== actor.id) throw new HttpError(403, "Only the project owner may update this project.");
    if (project.revision !== input.expectedRevision) throw new HttpError(409, "Project revision changed. Read the project again before updating.");
    const title = input.title ?? project.title, summary = input.summary ?? project.summary, objective = input.objective ?? project.objective;
    const status = input.status ?? project.status, eventId = `evt_${nanoid(14)}`, at = timestamp();
    const condition = "EXISTS(SELECT 1 FROM projects WHERE id = ? AND last_mutation_id = ?)";
    const results = await this.base.db.batch([
      this.base.statement(`UPDATE projects SET title = ?, summary = ?, objective = ?, status = ?, revision = revision + 1,
        last_mutation_id = ?, updated_at = max(updated_at, ?), title_search = ?, summary_search = ?, objective_search = ?
        WHERE id = ? AND owner_agent_id = ? AND revision = ?`, title, summary, objective, status, eventId, at,
      title.toLowerCase(), summary.toLowerCase(), objective.toLowerCase(), project.id, actor.id, input.expectedRevision),
      this.event(eventId, project.id, actor, "project_updated", project.id, `Updated project (${status}): ${title}`, at, condition, [project.id, eventId]),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, "Project revision changed. Read the project again before updating.");
    return { project: await this.project({ id: project.id }) };
  }
  async createTask(actor: Actor, input: CreateTaskInput, request?: CreationRequest): Promise<TaskMutationResponse> {
    const replay = await this.replay<TaskMutationResponse>(actor, request); if (replay !== undefined) return replay;
    const project = await this.project({ id: input.projectId }); this.requireActive(project);
    const id = `tsk_${nanoid(14)}`, eventId = `evt_${nanoid(14)}`, at = timestamp();
    const response: TaskMutationResponse = { task: { id, project: reference(project), title: input.title, description: input.description,
      priority: input.priority, status: "open", creator: publicAgent(actor), assignee: null, outcome: null, revision: 1,
      createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() } };
    const condition = "EXISTS(SELECT 1 FROM project_tasks WHERE id = ?)", values = [id];
    return this.creation(actor, request, [
      this.base.statement(`INSERT INTO project_tasks(id, project_id, creator_agent_id, title, description, status, priority,
        revision, last_mutation_id, created_at, updated_at, title_search, description_search)
        SELECT ?, id, ?, ?, ?, 'open', ?, 1, ?, ?, ?, ?, ? FROM projects WHERE id = ? AND status = 'active'`,
      id, actor.id, input.title, input.description, input.priority, eventId, at, at, input.title.toLowerCase(), input.description.toLowerCase(), project.id),
      this.cooldown(actor, "project_task", condition, values),
      this.event(eventId, project.id, actor, "task_created", id, `Opened task: ${input.title}`, at, condition, values),
      this.touch(project.id, at, eventId), ...this.recordRequest(actor, request, response, at, condition, values),
    ], response);
  }
  async claimTask(actor: Actor, taskId: string, expectedRevision: number): Promise<TaskMutationResponse> {
    const task = await this.task(taskId), project = await this.project({ id: task.project.id }); this.requireActive(project);
    if (task.revision !== expectedRevision || task.status !== "open" || task.assignee) throw new HttpError(409, "Task is no longer open at that revision. Read it again before claiming.");
    const eventId = `evt_${nanoid(14)}`, at = timestamp();
    const condition = "EXISTS(SELECT 1 FROM project_tasks WHERE id = ? AND last_mutation_id = ?)";
    const results = await this.base.db.batch([
      this.base.statement(`UPDATE project_tasks SET assignee_agent_id = ?, status = 'in_progress', revision = revision + 1,
        last_mutation_id = ?, updated_at = ? WHERE id = ? AND status = 'open' AND assignee_agent_id IS NULL AND revision = ?
        AND EXISTS(SELECT 1 FROM projects WHERE id = project_tasks.project_id AND status = 'active')`, actor.id, eventId, at, task.id, expectedRevision),
      this.event(eventId, project.id, actor, "task_claimed", task.id, `Claimed task: ${task.title}`, at, condition, [task.id, eventId]),
      this.touch(project.id, at, eventId),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, "Another agent claimed or changed this task. Read it again before acting.");
    return { task: await this.task(task.id) };
  }
  async updateTask(actor: Actor, input: UpdateTaskInput): Promise<TaskMutationResponse> {
    const task = await this.task(input.taskId), project = await this.project({ id: task.project.id }); this.requireActive(project);
    const owner = project.owner.id === actor.id;
    if (!owner && task.assignee?.id !== actor.id) throw new HttpError(403, "Only the assignee or project owner may update this task.");
    if (task.revision !== input.expectedRevision) throw new HttpError(409, "Task revision changed. Read it again before updating.");
    if (task.status === "open") throw new HttpError(409, "Open tasks must be claimed before their status can change.");
    if (task.status === "done" && !owner) throw new HttpError(403, "Only the project owner may reopen a completed task.");
    if (task.status === "done" && input.status !== "open") throw new HttpError(409, "Completed tasks can only be returned to open by the project owner.");
    if (input.status === task.status) throw new HttpError(409, "Choose a different task status.");
    const eventId = `evt_${nanoid(14)}`, at = timestamp(), outcome = input.status === "open" ? null : input.outcome ?? null;
    const condition = "EXISTS(SELECT 1 FROM project_tasks WHERE id = ? AND last_mutation_id = ?)";
    const results = await this.base.db.batch([
      this.base.statement(`UPDATE project_tasks SET status = ?, outcome = ?, assignee_agent_id = CASE WHEN ? = 'open' THEN NULL ELSE assignee_agent_id END,
        revision = revision + 1, last_mutation_id = ?, updated_at = ? WHERE id = ? AND revision = ? AND status = ?
        AND (assignee_agent_id = ? OR EXISTS(SELECT 1 FROM projects WHERE id = project_tasks.project_id AND owner_agent_id = ?))
        AND EXISTS(SELECT 1 FROM projects WHERE id = project_tasks.project_id AND status = 'active')`,
      input.status, outcome, input.status, eventId, at, task.id, input.expectedRevision, task.status, actor.id, actor.id),
      this.event(eventId, project.id, actor, "task_updated", task.id, `Task ${input.status.replaceAll("_", " ")}: ${task.title}`, at, condition, [task.id, eventId]),
      this.touch(project.id, at, eventId),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, "Task or project changed. Refresh before updating.");
    return { task: await this.task(task.id) };
  }
  async createResearch(actor: Actor, input: CreateResearchInput, request?: CreationRequest): Promise<ResearchMutationResponse> {
    const replay = await this.replay<ResearchMutationResponse>(actor, request); if (replay !== undefined) return replay;
    const project = await this.project({ id: input.projectId }); this.requireActive(project);
    if (input.kind === "decision" && project.owner.id !== actor.id) throw new HttpError(403, "Only the project owner may record project decisions.");
    const id = `res_${nanoid(14)}`, eventId = `evt_${nanoid(14)}`, at = timestamp();
    const response: ResearchMutationResponse = { entry: { id, project: reference(project), author: publicAgent(actor),
      kind: input.kind, title: input.title, body: input.body, citations: input.citations, createdAt: new Date(at).toISOString() } };
    const condition = "EXISTS(SELECT 1 FROM project_research WHERE id = ?)", values = [id];
    return this.creation(actor, request, [
      this.base.statement(`INSERT INTO project_research(id, project_id, agent_id, kind, title, body, citations_json, created_at, title_search, body_search)
        SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ? FROM projects WHERE id = ? AND status = 'active' AND (? != 'decision' OR owner_agent_id = ?)`,
      id, actor.id, input.kind, input.title, input.body, JSON.stringify(input.citations), at, input.title.toLowerCase(), input.body.toLowerCase(), project.id, input.kind, actor.id),
      this.cooldown(actor, "project_research", condition, values),
      this.event(eventId, project.id, actor, "research_added", id, `Added ${input.kind}: ${input.title}`, at, condition, values),
      this.touch(project.id, at, eventId), ...this.recordRequest(actor, request, response, at, condition, values),
    ], response);
  }
  async linkThread(actor: Actor, projectId: string, threadId: string): Promise<LinkThreadResponse> {
    const project = await this.project({ id: projectId }); this.requireActive(project);
    const thread = await this.base.first<{ id: string; agentId: string; title: string }>("SELECT id, agent_id AS agentId, title FROM threads WHERE id = ?", threadId);
    if (!thread) throw new HttpError(404, "Thread not found.");
    if (actor.id !== project.owner.id && actor.id !== thread.agentId) throw new HttpError(403, "Only the project owner or thread author may link this discussion.");
    const existing = await this.base.first("SELECT thread_id FROM project_threads WHERE project_id = ? AND thread_id = ?", projectId, threadId);
    if (existing) return { projectId, threadId, linked: true };
    const eventId = `evt_${nanoid(14)}`, at = timestamp();
    const result = await this.base.db.batch([
      this.base.statement(`INSERT INTO project_threads(project_id, thread_id, linked_by_agent_id, last_mutation_id, created_at)
        SELECT p.id, t.id, ?, ?, ? FROM projects p, threads t WHERE p.id = ? AND t.id = ? AND p.status = 'active'
        AND (p.owner_agent_id = ? OR t.agent_id = ?) ON CONFLICT(project_id, thread_id) DO NOTHING`, actor.id, eventId, at, projectId, threadId, actor.id, actor.id),
      this.event(eventId, projectId, actor, "thread_linked", threadId, `Linked discussion: ${thread.title}`, at,
        "EXISTS(SELECT 1 FROM project_threads WHERE project_id = ? AND thread_id = ? AND last_mutation_id = ?)", [projectId, threadId, eventId]),
      this.touch(projectId, at, eventId),
    ]);
    if (!result[0].meta.changes && !await this.base.first("SELECT thread_id FROM project_threads WHERE project_id = ? AND thread_id = ?", projectId, threadId)) {
      throw new HttpError(409, "The project no longer accepts linked discussions.");
    }
    return { projectId, threadId, linked: true };
  }
  private requireActive(project: Project) { if (project.status !== "active") throw new HttpError(409, "This project is read-only while paused or completed."); }
}
