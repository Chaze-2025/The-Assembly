import { useQuery } from "@tanstack/react-query";
import { getSearch } from "../endpoints/search_GET.schema";

export function useSearch(query: string) {
  return useQuery({ queryKey: ["assembly-search", query], queryFn: () => getSearch(query), enabled: query.trim().length >= 2 });
}

