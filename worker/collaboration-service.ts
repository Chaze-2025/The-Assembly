import { z } from "zod";
import {
  activityListSchema, claimTaskSchema, createProjectSchema, createResearchSchema, createTaskSchema,
  linkThreadSchema, projectListSchema, projectReferenceSchema, researchListSchema, taskListSchema,
  updateProjectSchema, updateTaskSchema,
} from "../src/shared/collaboration";
import { CollaborationRepository, type CreationRequest } from "./collaboration-repository";
import { HttpError, sha256 } from "./http";
import type { Assembly } from "./service";

const id = z.string().trim().min(1).max(80);
async function creationRequest(operation: string, input: { idempotencyKey?: string }): Promise<CreationRequest | undefined> {
  if (!input.idempotencyKey) return undefined;
  // Inputs have already passed a fixed-order Zod schema, so hashes ignore unknown fields,
  // surrounding whitespace, defaults, and transport authentication material.
  const { idempotencyKey: key, ...content } = input;
  return { key, operation, hash: await sha256(JSON.stringify(content)) };
}

export class Collaboration {
  readonly repo: CollaborationRepository;
  constructor(readonly app: Assembly) { this.repo = new CollaborationRepository(app.repo); }
  listProjects(value: unknown) { return this.repo.listProjects(projectListSchema.parse(value)); }
  detail(value: unknown) { return this.repo.detail(projectReferenceSchema.parse(value)); }
  tasks(value: unknown) { return this.repo.tasks(taskListSchema.parse(value)); }
  research(value: unknown, requireProject = false) {
    const input = researchListSchema.parse(value);
    if (requireProject && !input.projectId) throw new HttpError(400, "Missing projectId.");
    return this.repo.research(input);
  }
  entry(value: unknown) { return this.repo.entry(id.parse(value)); }
  async task(value: unknown) { return { task: await this.repo.task(id.parse(value)) }; }
  activity(value: unknown) { return this.repo.activity(activityListSchema.parse(value)); }
  discussions(value: unknown) { return this.repo.discussions(activityListSchema.parse(value)); }
  context(value: unknown) { return this.repo.context(id.parse(value)); }
  async createProject(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = createProjectSchema.parse(value);
    return this.repo.createProject(actor, input, await creationRequest("project.create", input));
  }
  async updateProject(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = updateProjectSchema.parse(value);
    return this.repo.updateProject(actor, input);
  }
  async createTask(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = createTaskSchema.parse(value);
    return this.repo.createTask(actor, input, await creationRequest("task.create", input));
  }
  async claimTask(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = claimTaskSchema.parse(value);
    return this.repo.claimTask(actor, input.taskId, input.expectedRevision);
  }
  async updateTask(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = updateTaskSchema.parse(value);
    return this.repo.updateTask(actor, input);
  }
  async createResearch(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = createResearchSchema.parse(value);
    return this.repo.createResearch(actor, input, await creationRequest("research.create", input));
  }
  async linkThread(value: unknown, key?: unknown) {
    const actor = await this.app.writer(key), input = linkThreadSchema.parse(value);
    return this.repo.linkThread(actor, input.projectId, input.threadId);
  }
}

export const collaborationMethods: Record<string, "GET" | "POST"> = {
  "/_api/projects": "GET",
  "/_api/project": "GET",
  "/_api/project/tasks": "GET",
  "/_api/project/task": "GET",
  "/_api/project/research": "GET",
  "/_api/project/activity": "GET",
  "/_api/project/discussions": "GET",
  "/_api/project/context": "GET",
  "/_api/research": "GET",
  "/_api/research/entry": "GET",
  "/_api/projects/create": "POST",
  "/_api/projects/update": "POST",
  "/_api/tasks/create": "POST",
  "/_api/tasks/claim": "POST",
  "/_api/tasks/update": "POST",
  "/_api/research/create": "POST",
  "/_api/projects/link-thread": "POST",
};

/** The caller keeps the existing method, body-size, CORS, rate-limit, and error handling. */
export async function handleCollaboration(app: Assembly, path: string, url: URL, value?: unknown): Promise<unknown> {
  const collaboration = new Collaboration(app), query = Object.fromEntries(url.searchParams);
  if (path === "/_api/projects") return collaboration.listProjects(query);
  if (path === "/_api/project") return collaboration.detail(query);
  if (path === "/_api/project/tasks") return collaboration.tasks(query);
  if (path === "/_api/project/task") return collaboration.task(query.id);
  if (path === "/_api/project/research") return collaboration.research(query, true);
  if (path === "/_api/project/activity") return collaboration.activity(query);
  if (path === "/_api/project/discussions") return collaboration.discussions(query);
  if (path === "/_api/project/context") return collaboration.context(query.projectId);
  if (path === "/_api/research") return collaboration.research(query);
  if (path === "/_api/research/entry") return collaboration.entry(query.id);
  if (path === "/_api/projects/create") return collaboration.createProject(value);
  if (path === "/_api/projects/update") return collaboration.updateProject(value);
  if (path === "/_api/tasks/create") return collaboration.createTask(value);
  if (path === "/_api/tasks/claim") return collaboration.claimTask(value);
  if (path === "/_api/tasks/update") return collaboration.updateTask(value);
  if (path === "/_api/research/create") return collaboration.createResearch(value);
  if (path === "/_api/projects/link-thread") return collaboration.linkThread(value);
  throw new HttpError(404, "Endpoint not found.");
}
