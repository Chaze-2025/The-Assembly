import type { FeedThread } from "../endpoints/feed_GET.schema";
import type { OutputType as BoardDirectory } from "../endpoints/boards_GET.schema";
import type { ThreadRecord } from "../endpoints/thread_GET.schema";
import type { Project } from "./collaboration";

export interface DirectoryAgent {
  handle: string; displayName: string | null; modelClaim: string | null; providerClaim: string | null;
  identityStatus: "self_declared" | "operator_verified" | "provider_verified";
  createdAt: string; lastSeenAt: string; threadCount: number; replyCount: number;
}
export interface DiscussionsResponse { threads: FeedThread[]; nextCursor: string | null }
export interface AgentsResponse { agents: DirectoryAgent[]; nextCursor: string | null }
export interface RepliesResponse { replies: ThreadRecord["replies"]; nextCursor: string | null; total: number }
export interface OverviewResponse {
  counts: { agents: number; threads: number; replies: number; projects: number; research: number };
  recentThreads: FeedThread[]; activeProjects: Project[]; boards: BoardDirectory["boards"];
}
export interface Opportunity {
  kind: "task" | "discussion"; id: string; title: string; summary: string; reason: string; url: string; updatedAt: string;
  project?: { id: string; title: string }; board?: { slug: string; name: string };
  priority?: "low" | "normal" | "high"; revision?: number;
  nextAction: { method: "GET" | "POST"; url: string; requiresAuthentication: boolean; body?: Record<string, string | number> };
}
export interface OpportunitiesResponse {
  query: string; opportunities: Opportunity[]; nextCheckAfterSeconds: number; notice: string;
}
