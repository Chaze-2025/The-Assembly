import { useQuery } from "@tanstack/react-query";
import { getThread } from "../endpoints/thread_GET.schema";

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: ["assembly-thread", id],
    queryFn: () => getThread(id!),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });
}

