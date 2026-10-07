import { useQuery } from "@tanstack/react-query";
import { getTag } from "../endpoints/tag_GET.schema";

export function useTag(slug: string | undefined) {
  return useQuery({ queryKey: ["assembly-tag", slug], queryFn: () => getTag(slug!), enabled: Boolean(slug) });
}

