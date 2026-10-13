import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type {
  ActivityListResponse,
  Page,
  ProjectDetailResponse,
  ProjectDiscussion,
  ProjectListResponse,
  ProjectStatus,
  ProjectTask,
  ResearchEntry,
  ResearchKind,
  ResearchListResponse,
  TaskListResponse,
  TaskStatus,
} from "../shared/collaboration";

export class CollaborationApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CollaborationApiError";
  }
}

type QueryValues = Record<string, string | number | undefined>;

export function collaborationUrl(path: string, values: QueryValues = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.size ? `${path}?${params}` : path;
}

async function readCollaboration<T>(path: string, values: QueryValues, signal: AbortSignal): Promise<T> {
  const response = await fetch(collaborationUrl(path, values), { signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : "The public record could not be loaded. Please try again.";
    throw new CollaborationApiError(message, response.status);
  }
  if (data === null) throw new CollaborationApiError("The public record returned an unreadable response.", response.status);
  return data as T;
}

const queryOptions = {
  staleTime: 30_000,
  retry: (count: number, error: Error) => !(error instanceof CollaborationApiError && error.status < 500) && count < 2,
};

type Pagination = { cursor?: string; limit?: number };
type SectionOptions = Pagination & { enabled?: boolean };

export function useProjects({ q, status, cursor, limit = 12, enabled = true }: Pagination & { q?: string; status?: ProjectStatus; enabled?: boolean } = {}) {
  const values = { q, status, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-projects", values], enabled, queryFn: ({ signal }) => readCollaboration<ProjectListResponse>("/_api/projects", values, signal) });
}

export function useProject(projectId: string) {
  return useQuery({ ...queryOptions, queryKey: ["assembly-project", projectId], enabled: Boolean(projectId), queryFn: ({ signal }) => readCollaboration<ProjectDetailResponse>("/_api/project", { id: projectId }, signal) });
}

export function useProjectTasks(projectId: string, { status, cursor, limit = 12, enabled = true }: SectionOptions & { status?: TaskStatus } = {}) {
  const values = { projectId, status, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-project-tasks", values], enabled: Boolean(projectId) && enabled, queryFn: ({ signal }) => readCollaboration<TaskListResponse>("/_api/project/tasks", values, signal) });
}

export function useProjectTask(taskId: string) {
  return useQuery({ ...queryOptions, queryKey: ["assembly-project-task", taskId], enabled: Boolean(taskId), queryFn: ({ signal }) => readCollaboration<{ task: ProjectTask }>("/_api/project/task", { id: taskId }, signal) });
}

export function useProjectResearch(projectId: string, { kind, q, cursor, limit = 12, enabled = true }: SectionOptions & { kind?: ResearchKind; q?: string } = {}) {
  const values = { projectId, kind, q, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-project-research", values], enabled: Boolean(projectId) && enabled, queryFn: ({ signal }) => readCollaboration<ResearchListResponse>("/_api/project/research", values, signal) });
}

export function useProjectDiscussions(projectId: string, { cursor, limit = 12, enabled = true }: SectionOptions = {}) {
  const values = { projectId, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-project-discussions", values], enabled: Boolean(projectId) && enabled, queryFn: ({ signal }) => readCollaboration<Page<ProjectDiscussion>>("/_api/project/discussions", values, signal) });
}

export function useProjectActivity(projectId: string, { cursor, limit = 24, enabled = true }: SectionOptions = {}) {
  const values = { projectId, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-project-activity", values], enabled: Boolean(projectId) && enabled, queryFn: ({ signal }) => readCollaboration<ActivityListResponse>("/_api/project/activity", values, signal) });
}

export function useResearch({ q, kind, projectId, cursor, limit = 12, enabled = true }: Pagination & { q?: string; kind?: ResearchKind; projectId?: string; enabled?: boolean } = {}) {
  const values = { q, kind, projectId, cursor, limit };
  return useQuery({ ...queryOptions, queryKey: ["assembly-research", values], enabled, queryFn: ({ signal }) => readCollaboration<ResearchListResponse>("/_api/research", values, signal) });
}

export function useResearchEntry(entryId: string) {
  return useQuery({ ...queryOptions, queryKey: ["assembly-research-entry", entryId], enabled: Boolean(entryId), queryFn: ({ signal }) => readCollaboration<{ entry: ResearchEntry }>("/_api/research/entry", { id: entryId }, signal) });
}

export function recordDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function recordTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export function readableStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
}

/** Public sources are links only. No previews or remote source content are fetched. */
export function publicCitation(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Keep cursor URLs shareable while retaining backwards navigation within this visit. */
export function usePaginationLinks(params: URLSearchParams) {
  const location = useLocation();
  const firstParams = new URLSearchParams(params);
  firstParams.delete("cursor");
  firstParams.sort();
  const first = `${location.pathname}${firstParams.size ? `?${firstParams}` : ""}`;
  const state = location.state as { assemblyPagination?: { key?: string; cursors?: unknown } } | null;
  const stored = state?.assemblyPagination;
  const history = stored?.key === first && Array.isArray(stored.cursors) && stored.cursors.every(value => typeof value === "string")
    ? stored.cursors as string[]
    : [];
  const to = (cursor: string) => {
    const next = new URLSearchParams(params);
    if (cursor) next.set("cursor", cursor);
    else next.delete("cursor");
    return `${location.pathname}${next.size ? `?${next}` : ""}`;
  };
  return {
    first,
    previous: history.length ? {
      to: to(history[history.length - 1]),
      state: { assemblyPagination: { key: first, cursors: history.slice(0, -1) } },
    } : undefined,
    next: (cursor: string) => ({
      to: to(cursor),
      state: { assemblyPagination: { key: first, cursors: [...history, params.get("cursor") ?? ""] } },
    }),
  };
}

/** Keep a newly selected result page in view, including keyboard and history navigation. */
export function useCollectionNavigation(identity: string, ready: boolean, headingId: string) {
  const previous = useRef(identity);
  useEffect(() => {
    if (previous.current === identity || !ready) return;
    const heading = document.getElementById(headingId);
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
    previous.current = identity;
  }, [identity, ready, headingId]);
}
