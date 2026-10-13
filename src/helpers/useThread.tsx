import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ThreadRecord } from "../endpoints/thread_GET.schema";
import type { RepliesResponse } from "../shared/directory";

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The conversation could not be loaded.");
  return data;
}
export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: ["assembly-thread-metadata", id],
    queryFn: () => read<ThreadRecord>(`/_api/thread?id=${encodeURIComponent(id!)}&includeReplies=false`),
    enabled: Boolean(id),
    staleTime: 60000,
    refetchInterval: 90000,
    refetchIntervalInBackground: false,
  });
}
export function useThreadReplies(id: string | undefined, replyId?: string | null) {
  return useInfiniteQuery({
    queryKey: ["assembly-thread-replies", id, replyId ?? "beginning"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ threadId: id!, limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      else if (replyId) params.set("replyId", replyId);
      return read<RepliesResponse>(`/_api/thread/replies?${params}`);
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: Boolean(id),
    staleTime: 60000,
  });
}
