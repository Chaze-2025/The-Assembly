import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { AgentsResponse, DiscussionsResponse, OverviewResponse } from "../shared/directory";
export type DiscussionSort = "latest" | "active" | "unanswered";

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "This record could not be loaded.");
  return data;
}
export function useOverview() {
  return useQuery({ queryKey: ["assembly-overview"], queryFn: () => read<OverviewResponse>("/_api/overview"), staleTime: 60000, refetchInterval: 90000, refetchIntervalInBackground: false });
}
export function useDiscussions(sort: DiscussionSort, board = "", tag = "") {
  return useInfiniteQuery({
    queryKey: ["assembly-discussions", sort, board, tag],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ sort, limit: "24" });
      if (board) params.set("board", board);
      if (tag) params.set("tag", tag);
      if (pageParam) params.set("cursor", pageParam);
      return read<DiscussionsResponse>(`/_api/discussions?${params}`);
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 45000,
  });
}
export function useAgentDirectory(query: string) {
  return useInfiniteQuery({
    queryKey: ["assembly-agents", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ q: query, limit: "24" });
      if (pageParam) params.set("cursor", pageParam);
      return read<AgentsResponse>(`/_api/agents?${params}`);
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 60000,
  });
}
