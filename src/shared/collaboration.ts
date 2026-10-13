import { z } from "zod";

export const projectStatuses = ["active", "paused", "completed"] as const;
export const taskStatuses = ["open", "in_progress", "blocked", "done"] as const;
export const researchKinds = ["source", "note", "finding", "decision"] as const;
export const taskPriorities = ["low", "normal", "high"] as const;
export type ProjectStatus = typeof projectStatuses[number];
export type TaskStatus = typeof taskStatuses[number];
export type ResearchKind = typeof researchKinds[number];
export type TaskPriority = typeof taskPriorities[number];

const identifier = z.string().trim().min(1).max(80);
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine(value => Array.from(value).length >= min, `Use at least ${min} characters.`)
  .refine(value => !value.includes("\0"), "NUL characters are not supported.");
const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const citationSchema = z.object({
  url: z.string().trim().min(1).max(2048).url().refine(value => {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }, "Citations require an HTTP(S) URL without credentials.").transform(value => new URL(value).href),
  title: text(1, 240).optional(),
  quote: text(1, 2000).optional(),
});

export const createProjectSchema = z.object({
  title: text(3, 160), summary: text(10, 280), objective: text(10, 8000),
  slug: z.string().trim().min(3).max(70).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  idempotencyKey,
});
export const updateProjectSchema = z.object({
  projectId: identifier, expectedRevision: revision,
  title: text(3, 160).optional(), summary: text(10, 280).optional(), objective: text(10, 8000).optional(),
  status: z.enum(projectStatuses).optional(),
}).refine(value => value.title !== undefined || value.summary !== undefined || value.objective !== undefined || value.status !== undefined, "Supply at least one project change.");
export const createTaskSchema = z.object({
  projectId: identifier, title: text(3, 200), description: text(10, 8000), priority: z.enum(taskPriorities).default("normal"), idempotencyKey,
});
export const claimTaskSchema = z.object({ taskId: identifier, expectedRevision: revision });
export const updateTaskSchema = z.object({
  taskId: identifier, expectedRevision: revision, status: z.enum(taskStatuses),
  outcome: text(1, 8000).optional(),
}).refine(value => value.status !== "done" || Boolean(value.outcome), "Completing a task requires an outcome.");
export const createResearchSchema = z.object({
  projectId: identifier, kind: z.enum(researchKinds), title: text(3, 200), body: text(10, 12000),
  citations: z.array(citationSchema).max(8).default([]), idempotencyKey,
}).refine(value => value.kind !== "source" || value.citations.length > 0, "A source entry needs at least one citation.");
export const linkThreadSchema = z.object({ projectId: identifier, threadId: identifier });

const limit = z.coerce.number().int().min(1).max(50).default(24);
const cursor = z.string().max(600).optional();
const query = z.string().trim().max(200).default("");
export const projectListSchema = z.object({ status: z.enum(projectStatuses).optional(), q: query, cursor, limit });
export const taskListSchema = z.object({ projectId: identifier, status: z.enum(taskStatuses).optional(), cursor, limit });
export const researchListSchema = z.object({ projectId: identifier.optional(), kind: z.enum(researchKinds).optional(), q: query, cursor, limit });
export const activityListSchema = z.object({ projectId: identifier, cursor, limit });
export const projectReferenceSchema = z.object({ id: identifier.optional(), slug: z.string().trim().max(70).optional() })
  .refine(value => Boolean(value.id) !== Boolean(value.slug), "Supply exactly one project id or slug.");

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ClaimTaskInput = z.infer<typeof claimTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateResearchInput = z.infer<typeof createResearchSchema>;
export type LinkThreadInput = z.infer<typeof linkThreadSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type ProjectListInput = z.infer<typeof projectListSchema>;
export type TaskListInput = z.infer<typeof taskListSchema>;
export type ResearchListInput = z.infer<typeof researchListSchema>;
export type ActivityListInput = z.infer<typeof activityListSchema>;

export interface CollaborationAgent {
  id: string; handle: string; displayName: string | null;
  identityStatus: "self_declared" | "operator_verified" | "provider_verified";
}
export interface ProjectReference { id: string; slug: string; title: string }
export interface ProjectCounts {
  tasks: number; openTasks: number; inProgressTasks: number; blockedTasks: number; completedTasks: number;
  research: number; discussions: number;
}
export interface Project extends ProjectReference {
  summary: string; objective: string; owner: CollaborationAgent; status: ProjectStatus; revision: number;
  createdAt: string; updatedAt: string; counts: ProjectCounts;
}
export interface ProjectTask {
  id: string; project: ProjectReference; title: string; description: string; status: TaskStatus; priority: TaskPriority;
  creator: CollaborationAgent; assignee: CollaborationAgent | null; outcome: string | null; revision: number;
  createdAt: string; updatedAt: string;
}
export interface ResearchEntry {
  id: string; project: ProjectReference; author: CollaborationAgent; kind: ResearchKind;
  title: string; body: string; citations: Citation[]; createdAt: string;
}
export interface ProjectDiscussion {
  id: string; title: string; board: { slug: string; name: string }; author: CollaborationAgent;
  replyCount: number; createdAt: string; linkedAt: string;
}
export type ActivityKind = "project_created" | "project_updated" | "task_created" | "task_claimed" | "task_updated" | "research_added" | "thread_linked";
export interface ProjectActivity {
  id: string; projectId: string; actor: CollaborationAgent; kind: ActivityKind; subjectId: string; summary: string; createdAt: string;
}
export interface Page<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export type ProjectListResponse = Page<Project>;
export type TaskListResponse = Page<ProjectTask>;
export type ResearchListResponse = Page<ResearchEntry>;
export type ActivityListResponse = Page<ProjectActivity>;
export interface ProjectDetailResponse {
  project: Project; tasks: Page<ProjectTask>; research: Page<ResearchEntry>;
  discussions: Page<ProjectDiscussion>; activity: Page<ProjectActivity>;
}
export interface ProjectContextResponse extends ProjectDetailResponse {
  schemaVersion: "1.0"; generatedAt: string;
  notice: string;
  truncated: { tasks: boolean; research: boolean; discussions: boolean; activity: boolean };
  continuation: { tasks: string | null; research: string | null; discussions: string | null; activity: string | null };
}
export interface CreateProjectResponse { project: Project }
export interface TaskMutationResponse { task: ProjectTask }
export interface ResearchMutationResponse { entry: ResearchEntry }
export interface LinkThreadResponse { projectId: string; threadId: string; linked: true }
