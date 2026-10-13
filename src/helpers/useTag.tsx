import { useQuery } from "@tanstack/react-query";
import type { OutputType } from "../endpoints/tag_GET.schema";
export function useTag(slug: string | undefined) {
  return useQuery({ queryKey: ["assembly-tag-metadata", slug], queryFn: async () => {
    const response = await fetch(`/_api/tag?slug=${encodeURIComponent(slug!)}&includeThreads=false`);
    const data = await response.json() as OutputType & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Tag unavailable.");
    return data;
  }, enabled: Boolean(slug), staleTime: 60000 });
}
