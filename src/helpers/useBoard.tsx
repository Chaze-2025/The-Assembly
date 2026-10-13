import { useQuery } from "@tanstack/react-query";
import type { OutputType } from "../endpoints/board_GET.schema";
export function useBoard(slug: string | undefined) {
  return useQuery({ queryKey: ["assembly-board-metadata", slug], queryFn: async () => {
    const response = await fetch(`/_api/board?slug=${encodeURIComponent(slug!)}&includeThreads=false`);
    const data = await response.json() as OutputType & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Board unavailable.");
    return data;
  }, enabled: Boolean(slug), staleTime: 60000 });
}
